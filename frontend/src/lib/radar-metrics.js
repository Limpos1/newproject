// radar-metrics.js
// 레이더차트 5개 지표를 실제 Firestore 데이터로 계산하는 함수 모음.
//
// 사용하는 컬렉션 (전부 실제 확인된 것):
//   study_sessions   - 타이머 기록 (memberId, startedAt, durationSeconds)
//   study_plan_items - 오늘 할일 (memberId, planDate, progressRate, durationMinutes)
//   quizzes          - 퀴즈 (uid ⚠️memberId 아님, questions[])
//   quizzes/{id}/answers - 퀴즈 답안 서브컬렉션 (selectedChoice, correct)

import { db } from "../firebase";
import {
  collection, collectionGroup, query, where, getDocs, Timestamp,
} from "firebase/firestore";

function todayString() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------
// 1. 학습량 — 이번 주 학습시간 ÷ 본인 최근 8주 최댓값 × 100
// ---------------------------------------------------------------
async function getWeeklyMinutes(memberId, weeksAgoStart, weeksAgoEnd) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() - weeksAgoStart * 7);
  const start = new Date(now);
  start.setDate(start.getDate() - weeksAgoEnd * 7);

  const q = query(
    collection(db, "study_sessions"),
    where("memberId", "==", memberId),
    where("startedAt", ">=", Timestamp.fromDate(startOfDay(start))),
    where("startedAt", "<", Timestamp.fromDate(startOfDay(end)))
  );
  const snap = await getDocs(q);
  const totalSeconds = snap.docs.reduce((sum, d) => sum + (d.data().durationSeconds || 0), 0);
  return totalSeconds / 60; // 분 단위
}

async function calculateStudyAmountScore(memberId) {
  const thisWeek = await getWeeklyMinutes(memberId, 0, 1); // 이번 주

  // 최근 8주 각각의 주간 학습시간 중 최댓값 구하기
  const weeklyTotals = [];
  for (let i = 0; i < 8; i++) {
    weeklyTotals.push(await getWeeklyMinutes(memberId, i, i + 1));
  }
  const maxWeek = Math.max(...weeklyTotals, 1); // 0으로 나누기 방지

  const score = Math.min(100, Math.round((thisWeek / maxWeek) * 100));
  return { score, raw: `이번 주 ${Math.round(thisWeek)}분 (최근 8주 최댓값 ${Math.round(maxWeek)}분 대비)` };
}

// ---------------------------------------------------------------
// 2. 목표 달성률 — 오늘 실제 학습시간 ÷ 오늘 목표시간(할일 durationMinutes 합) × 100
// ---------------------------------------------------------------
async function calculateGoalAchievementScore(memberId) {
  const today = todayString();

  // 목표: 오늘 배정된 study_plan_item들의 durationMinutes 합
  const itemsQ = query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId),
    where("planDate", "==", today)
  );
  const itemsSnap = await getDocs(itemsQ);
  const goalMinutes = itemsSnap.docs.reduce((sum, d) => sum + (d.data().durationMinutes || 0), 0);

  // 실제: 오늘 study_sessions 합
  const todayStart = startOfDay(new Date());
  const sessionsQ = query(
    collection(db, "study_sessions"),
    where("memberId", "==", memberId),
    where("startedAt", ">=", Timestamp.fromDate(todayStart))
  );
  const sessionsSnap = await getDocs(sessionsQ);
  const actualMinutes = sessionsSnap.docs.reduce((sum, d) => sum + (d.data().durationSeconds || 0), 0) / 60;

  const score = goalMinutes > 0 ? Math.min(100, Math.round((actualMinutes / goalMinutes) * 100)) : 0;
  return { score, raw: `오늘 ${Math.round(actualMinutes)}분 / 목표 ${goalMinutes}분` };
}

// ---------------------------------------------------------------
// 3. 꾸준함 — 연속 학습일(progressRate>0인 날짜) ÷ 30일 상한 × 100
// ---------------------------------------------------------------
function calculateStreakFromDates(activeDates) {
  if (activeDates.length === 0) return 0;
  const sorted = [...new Set(activeDates)].sort();
  let streak = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const diffDays = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
    if (diffDays === 1) streak++;
    else break;
  }
  // 마지막 활동일이 오늘이나 어제가 아니면 스트릭 끊긴 것으로 간주
  const last = new Date(sorted[sorted.length - 1]);
  const diffFromToday = (startOfDay(new Date()) - startOfDay(last)) / 86400000;
  if (diffFromToday > 1) return 0;
  return streak;
}

async function calculateStreakScore(memberId) {
  const q = query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId),
    where("progressRate", ">", 0)
  );
  const snap = await getDocs(q);
  const activeDates = snap.docs.map((d) => d.data().planDate);
  const streakDays = calculateStreakFromDates(activeDates);

  const score = Math.min(100, Math.round((streakDays / 30) * 100));
  return { score, raw: `${streakDays}일 연속 (30일 상한 대비)` };
}

// ---------------------------------------------------------------
// 4. 할 일 완료율 — progressRate=100인 항목 ÷ 전체 항목 × 100
// ---------------------------------------------------------------
async function calculateCompletionScore(memberId) {
  const q = query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId)
  );
  const snap = await getDocs(q);
  const total = snap.size;
  const done = snap.docs.filter((d) => d.data().progressRate === 100).length;

  const score = total > 0 ? Math.round((done / total) * 100) : 0;
  return { score, raw: `${done}개 / 전체 ${total}개 완료` };
}

// ---------------------------------------------------------------
// 5. AI 정답률 — quizzes(uid 기준) 하위 answers 서브컬렉션 집계
// ---------------------------------------------------------------
async function calculateQuizAccuracyScore(memberId) {
  // ⚠️ quizzes 컬렉션은 memberId가 아니라 uid 필드를 씀 (팀 확인된 불일치)
  const quizzesQ = query(collection(db, "quizzes"), where("uid", "==", memberId));
  const quizzesSnap = await getDocs(quizzesQ);

  let totalAnswered = 0;
  let totalCorrect = 0;

  for (const quizDoc of quizzesSnap.docs) {
    const answersSnap = await getDocs(collection(db, "quizzes", quizDoc.id, "answers"));
    answersSnap.forEach((a) => {
      totalAnswered++;
      if (a.data().correct) totalCorrect++;
    });
  }

  const score = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
  return { score, raw: `${totalCorrect}/${totalAnswered}문제 정답 (최근 전체 기준)` };
}

// ---------------------------------------------------------------
// 전체 5개 지표 한 번에 계산
// ---------------------------------------------------------------
export async function getRadarMetrics(memberId) {
  const [studyAmount, goalAchievement, streak, completion, quizAccuracy] = await Promise.all([
    calculateStudyAmountScore(memberId),
    calculateGoalAchievementScore(memberId),
    calculateStreakScore(memberId),
    calculateCompletionScore(memberId),
    calculateQuizAccuracyScore(memberId),
  ]);

  return {
    labels: ["학습량", "목표 달성률", "꾸준함", "계획 완주율", "AI 정답률"],
    values: [studyAmount.score, goalAchievement.score, streak.score, completion.score, quizAccuracy.score],
    raw: {
      studyAmount: studyAmount.raw,
      goalAchievement: goalAchievement.raw,
      streak: streak.raw,
      completion: completion.raw,
      quizAccuracy: quizAccuracy.raw,
    },
  };
}
