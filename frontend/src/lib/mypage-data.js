// mypage-data.js
// 마이페이지 화면에 필요한 데이터를 전부 모아서 mockData와 똑같은 모양으로
// 돌려주는 함수. MyPageScreen.jsx는 이 함수 하나만 부르면 됨.

import { db } from "../firebase";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { getRadarMetrics } from "./radar-metrics";
import {
  BADGE_DEFS,
  getClosestNextBadge,
  calculateStreakDays,
  calculateQuizCorrectCount,
  calculatePlanCompletionCount,
  calculatePerfectDayCount,
  calculateTotalStudyHours,
} from "./badgeChecker";

// 뱃지 아이콘 경로는 이미지 파일 기준이라 계산으로 안 나옴 - 고정값 유지
const BADGE_TIER_ICONS = {
  streak: ["/assets/badges/streak-1.png","/assets/badges/streak-2.png","/assets/badges/streak-3.png","/assets/badges/streak-4.png","/assets/badges/streak-5.png"],
  quizMaster: ["/assets/badges/quizMaster-1.png","/assets/badges/quizMaster-2.png","/assets/badges/quizMaster-3.png","/assets/badges/quizMaster-4.png","/assets/badges/quizMaster-5.png"],
  planCompletion: ["/assets/badges/planCompletion-1.png","/assets/badges/planCompletion-2.png","/assets/badges/planCompletion-3.png","/assets/badges/planCompletion-4.png","/assets/badges/planCompletion-5.png"],
  perfectDay: ["/assets/badges/perfectDay-1.png","/assets/badges/perfectDay-2.png","/assets/badges/perfectDay-3.png","/assets/badges/perfectDay-4.png","/assets/badges/perfectDay-5.png"],
  totalStudyTime: ["/assets/badges/totalStudyTime-1.png","/assets/badges/totalStudyTime-2.png","/assets/badges/totalStudyTime-3.png","/assets/badges/totalStudyTime-4.png","/assets/badges/totalStudyTime-5.png"],
};

const BADGE_VALUE_CALCULATORS = {
  streak: calculateStreakDays,
  quizMaster: calculateQuizCorrectCount,
  planCompletion: calculatePlanCompletionCount,
  perfectDay: calculatePerfectDayCount,
  totalStudyTime: calculateTotalStudyHours,
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 특정 날짜 범위의 study_sessions 합계(분)
async function getSessionMinutes(memberId, startDate, endDate) {
  const q = query(
    collection(db, "study_sessions"),
    where("memberId", "==", memberId),
    where("startedAt", ">=", Timestamp.fromDate(startOfDay(startDate))),
    where("startedAt", "<", Timestamp.fromDate(startOfDay(endDate)))
  );
  const snap = await getDocs(q);
  return snap.docs.reduce((sum, d) => sum + (d.data().durationSeconds || 0), 0) / 60;
}

// 특정 날짜 범위의 study_plan_item durationMinutes 합계(목표 분)
async function getGoalMinutes(memberId, dateStrings) {
  let total = 0;
  for (const dateStr of dateStrings) {
    const q = query(
      collection(db, "study_plan_items"),
      where("memberId", "==", memberId),
      where("planDate", "==", dateStr)
    );
    const snap = await getDocs(q);
    total += snap.docs.reduce((sum, d) => sum + (d.data().durationMinutes || 0), 0);
  }
  return total;
}

function dateRange(start, days) {
  const arr = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    arr.push(d.toISOString().slice(0, 10));
  }
  return arr;
}

// ---------------------------------------------------------------
// 일간 분석 (일~토 요일별)
// ---------------------------------------------------------------
async function getDailyAnalysis(memberId) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // 이번 주 일요일

  const dates = dateRange(weekStart, 7);
  const labels = ["일", "월", "화", "수", "목", "금", "토"];

  const bars = [];
  for (let i = 0; i < 7; i++) {
    const minutes = await getSessionMinutes(memberId, new Date(dates[i]), new Date(new Date(dates[i]).getTime() + 86400000));
    const isToday = dates[i] === todayString();
    bars.push({ label: isToday ? `${labels[i]}(오늘)` : labels[i], minutes: Math.round(minutes), today: isToday });
  }

  const todayGoal = await getGoalMinutes(memberId, [todayString()]);
  const todayActual = bars.find((b) => b.today)?.minutes || 0;
  const todayRate = todayGoal > 0 ? Math.min(100, Math.round((todayActual / todayGoal) * 100)) : 0;

  // "나의 평균" = 최근 30일 하루 평균 학습시간
  const past30Start = new Date(now);
  past30Start.setDate(now.getDate() - 30);
  const past30Minutes = await getSessionMinutes(memberId, past30Start, now);
  const myAverage = Math.round(past30Minutes / 30);

  const streakDays = await calculateStreakDays(memberId);

  return {
    periodLabel: "오늘", goalLabel: "오늘 학습목표", actualLabel: "오늘 학습한 시간", rateLabel: "오늘 목표 달성률",
    periodGoalMinutes: todayGoal, periodActualMinutes: todayActual, periodRate: todayRate,
    streakText: `${streakDays}일 연속 학습중이에요!`,
    comparisonLabel: "나의 평균", comparisonAvgMinutes: myAverage || 1,
    bars,
  };
}

// ---------------------------------------------------------------
// 주간 분석 (이번 달 1주~4주)
// ---------------------------------------------------------------
async function getWeeklyAnalysis(memberId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const bars = [];
  for (let w = 0; w < 4; w++) {
    const weekStart = new Date(monthStart);
    weekStart.setDate(monthStart.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const minutes = await getSessionMinutes(memberId, weekStart, weekEnd);
    const isThisWeek = now >= weekStart && now < weekEnd;
    bars.push({ label: isThisWeek ? `${w + 1}주(이번 주)` : `${w + 1}주`, minutes: Math.round(minutes), today: isThisWeek });
  }

  const thisWeekBar = bars.find((b) => b.today) || bars[bars.length - 1];
  const weekGoal = thisWeekBar.minutes > 0 ? thisWeekBar.minutes : 1; // TODO: 요일별 목표 합산으로 교체 가능
  const weekRate = Math.min(100, Math.round((thisWeekBar.minutes / weekGoal) * 100));

  // "지난달 주간 평균"
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthMinutes = await getSessionMinutes(memberId, lastMonthStart, lastMonthEnd);
  const lastMonthWeeklyAvg = Math.round(lastMonthMinutes / 4);

  return {
    periodLabel: "이번 주", goalLabel: "주간 학습목표", actualLabel: "이번 주 학습한 시간", rateLabel: "이번 주 목표 달성률",
    periodGoalMinutes: weekGoal, periodActualMinutes: thisWeekBar.minutes, periodRate: weekRate,
    streakText: `이번 달 학습 현황`,
    comparisonLabel: "지난달 주간 평균", comparisonAvgMinutes: lastMonthWeeklyAvg || 1,
    bars,
  };
}

// ---------------------------------------------------------------
// 전체 마이페이지 데이터 조립
// ---------------------------------------------------------------
export async function getMyPageData(memberId, memberName = "회원") {
  const [
    totalHours, streakDays, radarMetrics, nextBadge, dailyAnalysis, weeklyAnalysis,
  ] = await Promise.all([
    calculateTotalStudyHours(memberId),
    calculateStreakDays(memberId),
    getRadarMetrics(memberId),
    getClosestNextBadge(memberId),
    getDailyAnalysis(memberId),
    getWeeklyAnalysis(memberId),
  ]);

  // 뱃지 개수(멤버 문서 기준)
  const badgesSnap = await getDocs(collection(db, "members", memberId, "badges"));
  const badgeCount = badgesSnap.size;

  // 뱃지별 currentValue 계산 (5개 병렬)
  const badges = await Promise.all(
    BADGE_DEFS.map(async (def) => ({
      key: def.key,
      label: def.label,
      unit: def.unit,
      tiers: def.tiers,
      tierIcons: BADGE_TIER_ICONS[def.key],
      currentValue: await BADGE_VALUE_CALCULATORS[def.key](memberId),
    }))
  );

  // 오늘 할일
  const todayItemsSnap = await getDocs(query(
    collection(db, "study_plan_items"),
    where("memberId", "==", memberId),
    where("planDate", "==", todayString())
  ));
  const todayItems = todayItemsSnap.docs.map((d) => ({
    id: d.id,
    subject: d.data().subject,
    content: d.data().content,
    progressRate: d.data().progressRate,
    completed: d.data().progressRate === 100,
  }));

  return {
    profile: {
      name: memberName,
      initial: memberName.slice(0, 1),
      totalHours: Math.round(totalHours * 10) / 10,
      badgeCount,
      streakDays,
      weeklyAchievementRate: weeklyAnalysis.periodRate,
      nextBadge: nextBadge || { label: "모든 뱃지 최고 단계 달성!", progressPct: 100 },
    },
    todayTodos: { items: todayItems },
    analysis: { daily: dailyAnalysis, weekly: weeklyAnalysis },
    radarMetrics,
    badges,
  };
}
