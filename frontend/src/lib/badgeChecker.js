// badgeChecker.js
// 회원의 실제 데이터를 뱃지 기준(tiers)과 비교해서, 새로 달성한 단계가
// 있으면 members/{memberId}/badges/{badgeKey} 에 기록한다.
// 언제 부르나: 지금은 "마이페이지 열 때마다"(MyPageScreen.jsx의 useEffect).

import { db } from "../firebase";
import {
  collection, collectionGroup, query, where, getDocs,
  doc, setDoc, getDoc, Timestamp,
} from "firebase/firestore";

// 뱃지 정의 (mock-data.js의 badges 배열과 tiers/label 동일하게 유지)
export const BADGE_DEFS = [
  { key: "streak", label: "연속 학습일", unit: "일", tiers: [7, 30, 90, 180, 365] },
  { key: "quizMaster", label: "퀴즈 정답왕", unit: "개", tiers: [10, 50, 100, 300, 500] },
  { key: "planCompletion", label: "계획 완주", unit: "개", tiers: [1, 3, 5, 10, 15] },
  { key: "perfectDay", label: "완벽한 날", unit: "번", tiers: [5, 10, 50, 100, 500] },
  { key: "totalStudyTime", label: "누적 학습시간", unit: "시간", tiers: [5, 10, 50, 100, 500] },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------
// 뱃지별 "현재 값" 계산
// ---------------------------------------------------------------
async function calculateStreakDays(memberId) {
  const q = query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId),
    where("progressRate", ">", 0)
  );
  const snap = await getDocs(q);
  const dates = [...new Set(snap.docs.map((d) => d.data().planDate))].sort();
  if (dates.length === 0) return 0;

  let streak = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    const diffDays = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
    if (diffDays === 1) streak++;
    else break;
  }
  const diffFromToday = (new Date(todayString()) - new Date(dates[dates.length - 1])) / 86400000;
  return diffFromToday > 1 ? 0 : streak;
}

async function calculateQuizCorrectCount(memberId) {
  // ⚠️ quizzes 컬렉션은 memberId가 아니라 uid 필드를 씀
  const quizzesSnap = await getDocs(query(collection(db, "quizzes"), where("uid", "==", memberId)));
  let correct = 0;
  for (const quizDoc of quizzesSnap.docs) {
    const answersSnap = await getDocs(collection(db, "quizzes", quizDoc.id, "answers"));
    answersSnap.forEach((a) => { if (a.data().correct) correct++; });
  }
  return correct;
}

async function calculatePlanCompletionCount(memberId) {
  const snap = await getDocs(query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId),
    where("progressRate", "==", 100)
  ));
  return snap.size;
}

async function calculatePerfectDayCount(memberId) {
  const snap = await getDocs(query(collection(db, "study_plan_items"), where("memberId", "==", memberId)));
  const byDate = {};
  snap.docs.forEach((d) => {
    const data = d.data();
    (byDate[data.planDate] ??= []).push(data.progressRate);
  });
  return Object.values(byDate).filter((rates) => rates.every((r) => r === 100)).length;
}

async function calculateTotalStudyHours(memberId) {
  const snap = await getDocs(query(collection(db, "study_sessions"), where("memberId", "==", memberId)));
  const totalSeconds = snap.docs.reduce((sum, d) => sum + (d.data().durationSeconds || 0), 0);
  return totalSeconds / 3600;
}

const VALUE_CALCULATORS = {
  streak: calculateStreakDays,
  quizMaster: calculateQuizCorrectCount,
  planCompletion: calculatePlanCompletionCount,
  perfectDay: calculatePerfectDayCount,
  totalStudyTime: calculateTotalStudyHours,
};

function getAchievedTier(currentValue, tiers) {
  const fromEnd = [...tiers].reverse().findIndex((t) => currentValue >= t);
  return fromEnd === -1 ? 0 : tiers.length - fromEnd;
}

// ---------------------------------------------------------------
// 전체 뱃지 판정 + 새로 달성한 것만 기록
// 반환값: 이번 호출에서 "새로 승급된" 뱃지 목록 (알림 등에 활용 가능)
// ---------------------------------------------------------------
export async function checkAndAwardBadges(memberId) {
  const newlyAwarded = [];

  for (const def of BADGE_DEFS) {
    const currentValue = await VALUE_CALCULATORS[def.key](memberId);
    const tierNum = getAchievedTier(currentValue, def.tiers);
    if (tierNum === 0) continue;

    const badgeRef = doc(db, "members", memberId, "badges", def.key);
    const existing = await getDoc(badgeRef);
    const existingTier = existing.exists() ? existing.data().tier : 0;

    if (tierNum > existingTier) {
      await setDoc(badgeRef, {
        badgeKey: def.key,
        tier: tierNum,
        currentValue,
        earnedAt: Timestamp.now(),
      });
      newlyAwarded.push({ ...def, tier: tierNum });
    }
  }

  return newlyAwarded;
}

// ---------------------------------------------------------------
// "이번 달 획득 개수" — earnedAt이 이번 달인 것만 카운트
// ---------------------------------------------------------------
export async function getBadgesEarnedThisMonth(memberId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const snap = await getDocs(collection(db, "members", memberId, "badges"));
  return snap.docs.filter((d) => d.data().earnedAt.toDate() >= monthStart).length;
}

// ---------------------------------------------------------------
// "다음 뱃지까지" — 진행률(%)이 가장 높은(=가장 가까운) 것 하나 선택
// ---------------------------------------------------------------
export async function getClosestNextBadge(memberId) {
  let closest = null;
  let closestProgress = -1;

  for (const def of BADGE_DEFS) {
    const currentValue = await VALUE_CALCULATORS[def.key](memberId);
    const tierNum = getAchievedTier(currentValue, def.tiers);
    if (tierNum === 5) continue; // 이미 최고 단계

    const nextThreshold = def.tiers[tierNum];
    const prevThreshold = tierNum > 0 ? def.tiers[tierNum - 1] : 0;
    const progress = (currentValue - prevThreshold) / (nextThreshold - prevThreshold);

    if (progress > closestProgress) {
      closestProgress = progress;
      closest = {
        label: `${nextThreshold}${def.unit} ${def.label}까지 ${nextThreshold - currentValue}${def.unit} 남음`,
        progressPct: Math.round(progress * 100),
      };
    }
  }
  return closest;
}

// ---------------------------------------------------------------
// 개별 계산 함수도 밖에서 재사용할 수 있게 추가로 내보냄
// (프로필 사이드바의 "누적학습", "연속학습" 등에서 재사용)
// ---------------------------------------------------------------
export {
  calculateStreakDays,
  calculateQuizCorrectCount,
  calculatePlanCompletionCount,
  calculatePerfectDayCount,
  calculateTotalStudyHours,
};
