import { useEffect, useRef, useState } from "react";
import "./MyPageScreen.css";
import { checkAndAwardBadges } from "../lib/badgeChecker";
import { getMyPageData } from "../lib/mypage-data";

// =========================================================================
// 마이페이지 대시보드 — Planit-Web-Dashboard(vanilla)를 React로 옮긴 버전.
// index.html + render.js + mock-data.js 를 그대로 이식했습니다.
// (구조/클래스명/로직 전부 원본과 동일 — 나중에 mockData 자리만 실제
//  Firestore 조회 결과로 바꾸면 됩니다. radar-metrics.js 참고)
// =========================================================================

function getAchievedTier(badge) {
  const fromEnd = [...badge.tiers].reverse().findIndex((t) => badge.currentValue >= t);
  return fromEnd === -1 ? 0 : badge.tiers.length - fromEnd;
}

// Chart.js를 CDN에서 동적으로 불러옴 (원본 index.html과 동일한 버전)
function useChartJs() {
  const [ready, setReady] = useState(!!window.Chart);
  useEffect(() => {
    if (window.Chart) { setReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, []);
  return ready;
}

function RadarCanvas({ metrics }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const chartJsReady = useChartJs();

  useEffect(() => {
    if (!chartJsReady || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new window.Chart(canvasRef.current, {
      type: "radar",
      data: {
        labels: metrics.labels,
        datasets: [{
          data: metrics.values,
          backgroundColor: "rgba(169,143,194,0.18)",
          borderColor: "#A98FC2",
          borderWidth: 2,
          pointBackgroundColor: "#A98FC2",
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { display: false },
            grid: { color: "#F7DCE0" },
            angleLines: { color: "#F7DCE0" },
            pointLabels: { font: { size: 11, family: "'Noto Sans KR'" }, color: "#4B3B47" },
          },
        },
      },
    });

    return () => chartRef.current && chartRef.current.destroy();
  }, [chartJsReady, metrics]);

  return (
    <canvas ref={canvasRef} role="img"
      aria-label="학습량, 목표달성률, 꾸준함, 계획완주율, AI학습정답률 5개 지표를 보여주는 오각형 레이더차트" />
  );
}

export default function MyPageScreen() {
  const [currentRange, setCurrentRange] = useState("daily");
  const [d, setD] = useState(null);       // 실제 데이터 (로딩 끝나면 채워짐)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const memberId = localStorage.getItem("userId");
    if (!memberId) {
      setLoadError("로그인이 필요해요.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        await checkAndAwardBadges(memberId); // 뱃지 먼저 판정
        const data = await getMyPageData(memberId);
        setD(data);
      } catch (e) {
        console.error(e);
        setLoadError("데이터를 불러오는 중 문제가 생겼어요.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="mypage2"><p style={{ padding: 32 }}>불러오는 중...</p></div>;
  if (loadError || !d) return <div className="mypage2"><p style={{ padding: 32, color: "#C0574B" }}>{loadError}</p></div>;

  const a = d.analysis[currentRange];

  const diff = a.periodActualMinutes - a.comparisonAvgMinutes;
  const pct = Math.round((diff / a.comparisonAvgMinutes) * 100);
  const growthClass = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "–";

  const maxBarValue = Math.max(...a.bars.map((b) => b.minutes), a.comparisonAvgMinutes, 1);

  const earnedBadges = d.badges.filter((b) => !b.pending && b.currentValue >= b.tiers[0]);
  const todayGoal = d.analysis.daily;

  return (
    <div className="mypage2">
      {/* ================= 왼쪽 프로필 사이드바 ================= */}
      <aside className="profile-sidebar">
        <div className="avatar-lg">{d.profile.initial}</div>
        <div className="name">{d.profile.name}님</div>

        <div className="ps-stat-grid">
          <div className="ps-stat"><div className="ic">⏱️</div><div className="v">{d.profile.totalHours}h</div><div className="l">누적 학습</div></div>
          <div className="ps-stat"><div className="ic">🏅</div><div className="v">{d.profile.badgeCount}</div><div className="l">뱃지</div></div>
          <div className="ps-stat"><div className="ic">🔥</div><div className="v">{d.profile.streakDays}일</div><div className="l">연속 학습</div></div>
          <div className="ps-stat"><div className="ic">✅</div><div className="v">{d.profile.weeklyAchievementRate}%</div><div className="l">이번 주 달성</div></div>
        </div>

        <div className="ps-progress">
          <div className="row"><span>다음 뱃지까지</span><span>{d.profile.nextBadge.label}</span></div>
          <div className="track"><div className="fill" style={{ width: `${d.profile.nextBadge.progressPct}%` }} /></div>
        </div>

        <div className="ps-badges-label">이번 달에 {earnedBadges.length}개의 뱃지를 획득했어요!</div>
        <div className="ps-badges-row">
          {earnedBadges.slice(0, 3).map((b) => (
            <div className="b" key={b.key}><img src={b.tierIcons[getAchievedTier(b) - 1]} alt={b.label} /></div>
          ))}
        </div>
      </aside>

      <div className="mypage2-main">
        {/* ================= 상단 3개 카드 ================= */}
        <div className="dash-top-row">
          <div className="top-card">
            <div className="head"><div className="ic-box" style={{ background: "var(--accent-soft)" }}>📝</div><div className="title">오늘 할일</div></div>
            <div className="today-list">
              {d.todayTodos.items.map((t) => (
                <span key={t.id}>{t.completed ? "✓" : "·"} [{t.subject}] {t.content} ({t.progressRate}%)</span>
              ))}
            </div>
          </div>

          <div className="top-card">
            <div className="head"><div className="ic-box" style={{ background: "var(--lav-soft)" }}>🎯</div><div className="title">학습목표</div></div>
            <div className="ps-progress" style={{ textAlign: "left" }}>
              <div className="row"><span>{todayGoal.periodActualMinutes}분 / {todayGoal.periodGoalMinutes}분</span><span>{todayGoal.periodRate}%</span></div>
              <div className="track" style={{ marginBottom: 0 }}><div className="fill" style={{ width: `${Math.min(todayGoal.periodRate, 100)}%` }} /></div>
            </div>
          </div>
        </div>

        {/* ================= 학습분석 + 학습 리포트 ================= */}
        <div className="dash-analysis-row">
          <div className="analysis-card">
            <div className="ac-head">
              <h3>학습분석</h3>
              <div className="view-toggle">
                <button className={currentRange === "daily" ? "active" : ""} onClick={() => setCurrentRange("daily")}>일간</button>
                <button className={currentRange === "weekly" ? "active" : ""} onClick={() => setCurrentRange("weekly")}>주간</button>
              </div>
            </div>

            <div className="streak-banner">🔥 {a.streakText}</div>

            <div className="goal-stats">
              <div className="row"><span>🚩 {a.goalLabel}</span><b>{a.periodGoalMinutes}분</b></div>
              <div className="row"><span>⏱️ {a.actualLabel}</span><b>{a.periodActualMinutes}분</b></div>
              <div className="row"><span>🎯 {a.rateLabel}</span><b>{a.periodRate}%</b></div>
            </div>

            <hr className="sep" />

            <div className="growth-row">
              <span>{a.comparisonLabel}({a.comparisonAvgMinutes}분) 대비</span>
              <span className={`growth-badge ${growthClass}`}>{arrow} {Math.abs(pct)}%</span>
            </div>

            <div className="mini-bars">
              {a.bars.map((b) => (
                <div className={`colb ${b.today ? "today" : ""}`} key={b.label}>
                  <div className="bar-pair">
                    <div className="actual" style={{ height: `${(b.minutes / maxBarValue) * 100}%` }} />
                    <div className="avg" style={{ height: `${(a.comparisonAvgMinutes / maxBarValue) * 100}%` }} />
                  </div>
                  <span className="lbl">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="mini-bars-legend">
              <span><span className="dot" style={{ background: "var(--lav-deep)" }} />나의 학습시간</span>
              <span><span className="dot" style={{ background: "var(--line)" }} />{a.comparisonLabel}</span>
            </div>

            <hr className="sep" />

            <div className="callout">
              <span className="q">"</span>
              <span>
                {diff >= 0
                  ? <>{a.comparisonLabel}보다 {a.periodLabel} <b>{Math.abs(diff)}분</b> 더 학습했어요!</>
                  : <>{a.comparisonLabel}보다 {a.periodLabel} <b>{Math.abs(diff)}분</b> 적게 학습했어요.</>}
              </span>
            </div>
          </div>

          <div className="analysis-card">
            <div className="ac-head">
              <h3>나의 학습 리포트</h3>
              <div className="view-toggle"><button className="active">이번 주</button></div>
            </div>
            <div className="radar-wrap">
              <RadarCanvas metrics={d.radarMetrics} />
            </div>
            <div className="callout">
              <span className="q">"</span>
              <span>
                가장 낮은 지표는 <b>계획 완주율({d.radarMetrics.values[3]}%)</b>,
                가장 높은 지표는 <b>AI 정답률({d.radarMetrics.values[4]}%)</b>이에요!
              </span>
            </div>
          </div>
        </div>

        {/* ================= 획득한 뱃지 ================= */}
        <div className="badge-section">
          <h3>획득한 뱃지</h3>
          <div className="badge-card-grid">
            {earnedBadges.length === 0 ? (
              <p className="badge-empty">아직 획득한 뱃지가 없어요. 학습을 시작해보세요!</p>
            ) : (
              earnedBadges.map((b) => (
                <div className="badge-earned" key={b.key}>
                  <div className="ic"><img src={b.tierIcons[getAchievedTier(b) - 1]} alt={b.label} /></div>
                  <div className="lbl">{b.label}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
