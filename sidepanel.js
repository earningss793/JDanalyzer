// ── STATE ──
let analysisResult = null;
let selectedImageBase64 = null; // 선택된 이미지 (업로드 or 페이지 이미지)
let currentFbTab = 'text';

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  loadProfile();
  updatePageInfo();   // 현재 탭 정보만 표시 (텍스트 긁기 X)
  bindTabs();
  bindFallbackTabs();
  bindButtons();
  bindImageUpload();
});

// 현재 탭 URL/타이틀만 표시 (API 호출 없음)
async function updatePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    document.getElementById('pageTitle').textContent = tab.title?.slice(0, 55) || '제목 없음';
    document.getElementById('pageUrl').textContent = tab.url || '';
    // favicon
    const fav = document.getElementById('pageFavicon');
    if (tab.favIconUrl) {
      fav.innerHTML = `<img src="${tab.favIconUrl}" alt=""/>`;
    }
  } catch (e) {}
}

// ── TABS ──
function bindTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ── FALLBACK TABS ──
function bindFallbackTabs() {
  document.querySelectorAll('.fb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fb-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.fb-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      currentFbTab = tab.dataset.fb;
      document.getElementById(`fb-${currentFbTab}`).classList.add('active');
      if (currentFbTab === 'pageimg') loadPageImages();
    });
  });
}

// ── BUTTONS ──
function bindButtons() {
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
  document.getElementById('fbAnalyzeBtn').addEventListener('click', runFallbackAnalysis);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
  document.getElementById('notionSaveBtn').addEventListener('click', saveToNotion);
}

// ── IMAGE UPLOAD ──
function bindImageUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
  });
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    selectedImageBase64 = e.target.result; // data:image/...;base64,...
    document.getElementById('uploadPreviewImg').src = selectedImageBase64;
    document.getElementById('uploadPreview').classList.add('active');
  };
  reader.readAsDataURL(file);
}

// 페이지 내 이미지 목록 로드
async function loadPageImages() {
  const list = document.getElementById('imgCandList');
  list.innerHTML = '<div style="font-size:11px;color:var(--muted);">페이지 이미지 스캔 중...</div>';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_IMAGES' });
    const images = resp?.images || [];
    if (!images.length) {
      list.innerHTML = '<div style="font-size:11px;color:var(--muted);">이미지를 찾지 못했습니다</div>';
      return;
    }
    list.innerHTML = '';
    images.forEach(src => {
      const item = document.createElement('div');
      item.className = 'img-cand-item';
      item.innerHTML = `<img src="${src}" alt=""/>`;
      item.addEventListener('click', async () => {
        document.querySelectorAll('.img-cand-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        // base64로 변환
        const r = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: src });
        if (r?.base64) selectedImageBase64 = r.base64;
      });
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);">로드 실패</div>';
  }
}

// ── MAIN ANALYSIS FLOW ──
async function runAnalysis() {
  const apiKey = window.OPENAI_API_KEY;
  if (!apiKey) { showToast('⚑ config.js에 API 키가 없습니다'); return; }

  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('results').style.display = 'none';
  document.getElementById('guideInsights').style.display = 'none';
  document.getElementById('fallbackUI').classList.remove('active');
  selectedImageBase64 = null;

  showProgress(true);

  // STEP 1: 텍스트 추출
  setStep(1, 'active');
  const { text, url, title } = await chrome.runtime.sendMessage({ type: 'GET_PAGE_TEXT' });

  if (text && text.length > 200) {
    // ✅ 텍스트 성공
    setStep(1, 'done');
    setStep(2, 'done'); // 이미지 불필요
    setStep(3, 'active');
    await callAnalysis(apiKey, { type: 'text', text });
  } else {
    // ❌ 텍스트 실패 → STEP 2: 이미지 시도
    setStep(1, 'fail');
    setStep(2, 'active');

    const imgResp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_IMAGES' });
    const images = imgResp?.images || [];

    if (images.length > 0) {
      // 첫 번째 이미지 base64 변환
      const b64Resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BASE64', url: images[0] });
      if (b64Resp?.base64) {
        setStep(2, 'done');
        setStep(3, 'active');
        await callAnalysis(apiKey, { type: 'image', base64: b64Resp.base64 });
      } else {
        // 이미지 변환 실패
        setStep(2, 'fail');
        showProgress(false);
        showFallback();
      }
    } else {
      // 이미지도 없음
      setStep(2, 'fail');
      showProgress(false);
      showFallback();
    }
  }

  document.getElementById('analyzeBtn').disabled = false;
}

// ── FALLBACK ANALYSIS ──
async function runFallbackAnalysis() {
  const apiKey = window.OPENAI_API_KEY;
  if (!apiKey) { showToast('⚑ config.js에 API 키가 없습니다'); return; }

  document.getElementById('fbAnalyzeBtn').disabled = true;

  if (currentFbTab === 'text') {
    const text = document.getElementById('manualText').value.trim();
    if (!text) { showToast('공고 텍스트를 입력해주세요'); document.getElementById('fbAnalyzeBtn').disabled = false; return; }
    showProgress(true);
    setStep(1, 'done'); setStep(2, 'done'); setStep(3, 'active');
    await callAnalysis(apiKey, { type: 'text', text });
  } else {
    // 업로드 or 페이지 이미지
    if (!selectedImageBase64) { showToast('이미지를 선택해주세요'); document.getElementById('fbAnalyzeBtn').disabled = false; return; }
    showProgress(true);
    setStep(1, 'done'); setStep(2, 'done'); setStep(3, 'active');
    await callAnalysis(apiKey, { type: 'image', base64: selectedImageBase64 });
  }

  document.getElementById('fbAnalyzeBtn').disabled = false;
}

// ── CALL OPENAI ──
async function callAnalysis(apiKey, input) {
  const profile = await getProfile();
  try {
    const messages = buildMessages(input, profile);
    const data = await callOpenAI(apiKey, messages);
    const raw = data.choices?.[0]?.message?.content || '';
    const json = extractJSON(raw);
    if (!json) throw new Error('응답 파싱 실패');
    analysisResult = json;
    setStep(3, 'done');
    showProgress(false);
    document.getElementById('fallbackUI').classList.remove('active');
    renderResults(json);
    renderGuide(json);
  } catch (e) {
    setStep(3, 'fail');
    showProgress(false);
    showToast('오류: ' + e.message);
    console.error(e);
  }
}

function buildMessages(input, profile) {
  const hasProfile = profile.role || profile.skills || profile.career;
  const profileText = hasProfile
    ? `[지원자 프로필]\n직무/연차: ${profile.role||'미입력'}\n보유스킬: ${profile.skills||'미입력'}\n경력요약: ${profile.career||'미입력'}\n희망직무: ${profile.target||'미입력'}`
    : '[지원자 프로필: 미입력]';

  const instruction = `당신은 10년 경력의 커리어 컨설턴트입니다. 채용공고를 분석해 JSON만 반환하세요.

${profileText}

JSON 형식:
{
  "company":"회사명또는null",
  "position":"직무명",
  "job_type":"performance또는brand또는content또는growth또는allrounder또는ae또는unknown",
  "jd_surface":"표면 업무 1~2줄",
  "jd_hidden":"숨은 기대 역할 1~2줄",
  "jd_signal":"우대사항 신호 1줄",
  "required_skills":["필수역량1"],
  "preferred_skills":["우대역량1"],
  "keywords":["키워드1"],
  "have_skills":${hasProfile?'["보유스킬"]':'[]'},
  "gap_skills":${hasProfile?'["갭스킬"]':'[]'},
  "match_score":${hasProfile?'0-100':'null'},
  "match_label":${hasProfile?'"낮음또는보통또는좋음또는매우좋음"':'null'},
  "recommendations":["제안1","제안2","제안3"]
}`;

  if (input.type === 'image') {
    const mediaType = input.base64.includes('image/png') ? 'image/png'
                    : input.base64.includes('image/webp') ? 'image/webp' : 'image/jpeg';
    const b64Data = input.base64.split(',')[1];
    return [
      { role: 'system', content: instruction },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64Data}` } },
        { type: 'text', text: '위 채용공고 이미지를 분석해주세요.' }
      ]}
    ];
  } else {
    return [
      { role: 'system', content: instruction },
      { role: 'user', content: `[채용공고]\n${input.text.slice(0, 6000)}` }
    ];
  }
}

const VERCEL_API = 'https://jdanalyzer.vercel.app/api/analyze';

async function callOpenAI(_apiKey, messages) {
  const res = await fetch(VERCEL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API ${res.status}`); }
  return res.json();
}

function extractJSON(t) {
  try { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// ── PROGRESS UI ──
function showProgress(on) {
  const w = document.getElementById('progressWrap');
  w.classList.toggle('active', on);
  if (on) {
    ['step1','step2','step3'].forEach(id => setStep(parseInt(id.slice(-1)), 'wait'));
  }
}

function setStep(n, state) {
  const el = document.getElementById(`step${n}`);
  el.className = `step ${state === 'active' ? 'active-step' : state}`;
  const icons = { 1: '📄', 2: '🖼', 3: '🤖' };
  const labels = {
    1: { wait: '텍스트 추출 대기', active: '텍스트 추출 중...', done: '텍스트 추출 완료', fail: '텍스트 추출 실패' },
    2: { wait: '이미지 확인 대기', active: '이미지 공고 확인 중...', done: '이미지 처리 완료', fail: '이미지 없음' },
    3: { wait: 'AI 분석 대기', active: 'AI 분석 중...', done: '분석 완료 ✓', fail: '분석 실패' }
  };
  el.querySelector('.step-icon').textContent = state === 'active' ? '' : icons[n];
  if (state === 'active') el.querySelector('.step-icon').innerHTML = '<div class="step-spin"></div>';
  el.querySelector('.step-text').textContent = labels[n][state] || '';
}

function showFallback() {
  document.getElementById('fallbackUI').classList.add('active');
}

// ── RENDER RESULTS ──
function renderResults(r) {
  if (r.match_score != null) {
    document.getElementById('matchScoreText').textContent = r.match_score + '%';
    document.getElementById('matchSubLabel').textContent = r.match_label || '';
    document.getElementById('matchRingLabel').textContent = r.match_score + '%';
    const circ = 2 * Math.PI * 23;
    document.getElementById('matchRingFill').style.strokeDashoffset = circ - (circ * r.match_score / 100);
  } else {
    document.getElementById('matchScoreText').textContent = '—';
    document.getElementById('matchSubLabel').textContent = '프로필 입력 후 확인';
  }
  renderTags('requiredTags', r.required_skills || [], 'tr');
  renderTags('preferredTags', r.preferred_skills || [], 'tp');
  renderTags('haveTags', r.have_skills || [], 'th');
  renderTags('gapTags', r.gap_skills || [], 'tg');

  const rl = document.getElementById('recList'); rl.innerHTML = '';
  (r.recommendations || []).forEach(rec => {
    const el = document.createElement('div'); el.className = 'rec-item';
    el.innerHTML = `<div class="rec-arrow">→</div><div class="rec-text">${rec}</div>`;
    rl.appendChild(el);
  });
  document.getElementById('results').style.display = 'block';
}

function renderTags(id, items, cls) {
  const el = document.getElementById(id);
  el.innerHTML = items.length ? items.map(t => `<span class="tag ${cls}">${t}</span>`).join('') : '<span class="te">없음</span>';
}

// ── GUIDE DATA ──
const GUIDE = {
  performance:{label:'퍼포먼스',evidence:['예산 규모보다 소재 교체·타깃 조정·랜딩 구조 변경 경험이 중요합니다','리포트→인사이트→다음 액션 제안까지 하나의 흐름으로 사례화하세요','A/B 실험·타깃 세그먼트 경험을 수치와 함께 정리하세요'],portfolio:['캠페인 배경/목표 지표/조정한 변수/결과/배운점 구조로 정리','수치 나열 말고 "왜 그 변수를 건드렸는지" 판단 근거를 써야 합니다','실패 사례도 원인 분석+후속 개선까지 보여주면 오히려 강점입니다'],interview:['성과가 떨어졌을 때 어떤 순서로 점검하는가?','예산이 적을 때 무엇부터 테스트할 것인가?','어트리뷰션 불일치를 어떻게 판단하는가?'],frame:[{k:'표면 업무',v:'광고 집행·운영·최적화'},{k:'숨은 기대',v:'수치 해석→개선안 도출→실행 사이클 반복 가능한 사람'},{k:'우대 신호',v:'SQL·GA4 언급 → 데이터 자립형 인재 선호'},{k:'핵심 질문',v:'가설을 세우고 실험을 설계할 줄 아는가?'}]},
  brand:{label:'브랜드',evidence:['감각만큼 논리가 중요합니다 — 왜 이 메시지를 선택했는지 설명해야 합니다','경쟁 브랜드와의 차별점·톤앤매너 유지 경험을 준비하세요','캠페인 리뷰, 컨셉 제안서가 좋은 재료입니다'],portfolio:['브랜드 진단/타깃 인사이트/메시지 방향/실행안/기대효과 구조로 구성','이해관계자와 메시지·포맷을 어떻게 합의했는지 과정도 중요합니다','지원 회사의 포지셔닝 분석+연결하는 제안형 사례가 강력합니다'],interview:['최근 인상 깊은 브랜드 캠페인과 그 이유는?','이 회사 브랜드의 강점과 보완점은?','메시지 방향에 대한 내부 의견이 충돌할 때 어떻게 설득했는가?'],frame:[{k:'표면 업무',v:'캠페인 기획·브랜드 커뮤니케이션'},{k:'숨은 기대',v:'포지셔닝 설계+이해관계자 설득+일관성 유지'},{k:'우대 신호',v:'카피·디자인 이해 언급 → 제작팀 협업 가능한 사람 선호'},{k:'핵심 질문',v:'브랜드 인상을 고객 머릿속에 설계할 수 있는가?'}]},
  content:{label:'콘텐츠',evidence:['결과물 모음집 말고 기획 의도와 운영 흐름이 드러나야 합니다','타깃·포맷 선택·반응 후 수정 흐름이 핵심 증빙입니다','반응 해석 후 다음 포맷으로 연결한 과정이 중요합니다'],portfolio:['콘텐츠 캘린더 운영/제작 협업/반응 분석/포맷 개선 경험을 흐름으로','조회수 나열 금지 — 반응 해석 후 다음 방향 연결 과정이 중요합니다','시리즈가 있다면 기획의도→반응→수정→결과 흐름으로 정리하세요'],interview:['가장 반응이 좋았던 콘텐츠와 그 이유는?','성과 안 나온 콘텐츠를 어떻게 개선했는가?','제작팀과 방향이 충돌할 때 어떻게 조율했는가?'],frame:[{k:'표면 업무',v:'콘텐츠 기획·제작·채널 운영'},{k:'숨은 기대',v:'반응 데이터를 읽고 다음 방향을 스스로 조정할 수 있는 사람'},{k:'우대 신호',v:'저장·공유 수치 언급 → 퍼포먼스 마인드셋 있는 콘텐츠 담당 선호'},{k:'핵심 질문',v:'무엇을 만들면 보고 저장하고 공유하는지 아는가?'}]},
  growth:{label:'그로스',evidence:['툴 사용 경험보다 문제 정의 능력이 먼저입니다','퍼널 분석→가설→실험→결과→학습 사이클을 경험으로 보여주세요','데이터·제품·고객 행동을 함께 이해하고 있다는 증거가 필요합니다'],portfolio:['문제 진단→가설→실험→결과→학습 순서를 분명하게 구성하세요','북극성 지표가 무엇이었는지 명시하면 실무 이해도가 드러납니다','CRM 시나리오, 전환 개선 아이디어도 작은 규모면 충분합니다'],interview:['어떤 지표를 먼저 볼 것인가?','한정된 리소스에서 어떤 실험을 우선할 것인가?','이탈 구간을 발견했을 때 가설을 어떻게 검증했는가?'],frame:[{k:'표면 업무',v:'퍼널 분석·실험·CRM·리텐션 개선'},{k:'숨은 기대',v:'유입이 아닌 활성화·리텐션 구조 전반 오너십 있는 사람'},{k:'우대 신호',v:'SQL·Amplitude 언급 → 데이터 자립형+제품 이해 선호'},{k:'핵심 질문',v:'데이터로 이탈과 성장을 볼 수 있는가?'}]},
  allrounder:{label:'올라운더',evidence:['다양하게 했다는 사실보다 어떤 상황에서 무엇을 먼저 했는지가 핵심입니다','제한된 리소스 안에서 우선순위를 정하고 성과를 낸 흐름을 보여주세요','여러 채널 나열 말고 한 프로젝트 안에서 조율과 실행을 보여주세요'],portfolio:['멀티채널 운영/월간 회고/실행 체계화 사례를 구조적으로 정리하세요','"이 달 가장 우선순위를 뒀던 것과 그 이유"를 설명할 수 있는 사례가 강합니다','스타트업 환경이라면 그 제약 자체를 배경으로 활용하세요'],interview:['업무가 동시에 몰릴 때 무엇부터 처리하는가?','성과 안 나오는 채널을 어떻게 판단하고 정리하는가?','한정된 예산에서 가장 임팩트 있는 실행을 결정한 경험은?'],frame:[{k:'표면 업무',v:'여러 채널 동시 운영·기획·실행 전반'},{k:'숨은 기대',v:'가장 중요한 마케팅 우선순위를 스스로 판단하고 실행까지 연결'},{k:'우대 신호',v:'스타트업·초기 서비스 언급 → 실행 속도+멀티태스킹 중요'},{k:'핵심 질문',v:'혼자서도 마케팅 전체를 굴릴 실행력이 있는가?'}]},
  ae:{label:'AE',evidence:['정보 우선순위를 잡고 상대가 이해하기 쉽게 정리하는 능력이 핵심입니다','클라이언트 요구→내부 실행으로 번역하는 조율 경험을 구체적으로 준비하세요','제안서, 일정 관리표, 이슈 대응 사례가 가장 강력한 증빙입니다'],portfolio:['프로젝트 목적/이해관계자/제안 방향/진행/이슈/결과 순으로 정리','일정 충돌·클라이언트-내부 리소스 갈등 때 조율 방식 반드시 포함','수정 요청 반복 상황과 대응 방식을 솔직하게 쓰면 실무 경험이 드러납니다'],interview:['클라이언트 요구가 비현실적일 때 어떻게 대응하는가?','내부 리소스와 외부 일정이 충돌할 때 어떻게 조정하는가?','가장 어려웠던 커뮤니케이션 경험은?'],frame:[{k:'표면 업무',v:'클라이언트 대응·제안·프로젝트 관리'},{k:'숨은 기대',v:'고객 목표를 실행 가능한 언어로 번역하고 내부 조율까지 책임'},{k:'우대 신호',v:'특정 산업 경험 언급 → 클라이언트사 이해도 선호'},{k:'핵심 질문',v:'이해관계자 사이에서 신뢰 유지하며 결과물 만들 수 있는가?'}]},
  unknown:{label:'마케팅',evidence:['공고의 동사(운영/기획/리드/총괄)가 기대 오너십 수준을 말해줍니다','우대사항은 팀이 당장 필요한 보완 포인트 — 해당 항목이 있다면 전면 배치','같은 마케터라도 회사마다 기대 역할이 다릅니다 — 회사 단계를 먼저 파악'],portfolio:['첫 페이지에서 지원 직무와 포지셔닝이 분명히 드러나야 합니다','각 프로젝트는 문제-목표-역할-실행-결과-배운점 흐름으로 정리','숫자가 없어도 프로세스 개선·운영 체계화도 충분한 증빙입니다'],interview:['이 직무에서 가장 자신 있는 역량과 그 증거는?','입사 후 초반 3개월 안에 기여할 수 있는 것은?','최근 인상 깊은 마케팅 사례와 그 이유는?'],frame:[{k:'동사 확인',v:'운영·기획·리드·총괄 → 기대 오너십 수준이 다릅니다'},{k:'협업 대상',v:'디자인·개발·영업·제작 언급 → 커뮤니케이션 복잡도 가늠'},{k:'우대사항',v:'툴·데이터 언급 → 팀이 당장 필요한 보완 포인트'},{k:'산업 맥락',v:'최근 캠페인·서비스 단계 조사 후 지원동기와 연결하세요'}]}
};

const DC = { blue:'gd-b', green:'gd-g', red:'gd-r', yellow:'gd-y' };
function gi(items, dot) {
  return items.map(t => `<div class="gi"><div class="gd ${DC[dot]||DC.blue}"></div><div>${t}</div></div>`).join('');
}

function renderGuide(r) {
  const g = GUIDE[r.job_type] || GUIDE.unknown;
  document.getElementById('guideJobBadge').textContent = g.label;
  const layers = [
    { dot:'blue', label:'표면 업무', val: r.jd_surface || '공고 분석에서 추출됨' },
    { dot:'yellow', label:'숨은 기대 역할', val: r.jd_hidden || '동사와 협업 대상을 통해 추론하세요' },
    { dot:'green', label:'우대사항 신호', val: r.jd_signal || '우대사항에 담긴 팀의 진짜 니즈입니다' },
  ];
  document.getElementById('guideJdLayerBody').innerHTML = layers.map(l =>
    `<div class="gi"><div class="gd ${DC[l.dot]}"></div><div><div class="gsub">${l.label}</div>${l.val}</div></div>`
  ).join('');
  document.getElementById('guideEvidenceBody').innerHTML = gi(g.evidence, 'blue');
  document.getElementById('guidePortfolioBody').innerHTML = gi(g.portfolio, 'green');
  document.getElementById('guideInterviewBody').innerHTML = gi(g.interview, 'red');
  document.getElementById('guideFrameTable').innerHTML = g.frame.map(f =>
    `<div class="gfr"><div class="gfk">${f.k}</div><div class="gfv">${f.v}</div></div>`
  ).join('');
  document.getElementById('guideInsights').style.display = 'block';
}

// ── SETTINGS / PROFILE ──
async function loadSettings() {
  const d = await chrome.storage.local.get(['apiKey','notionToken','notionDb']);
  if (d.apiKey) document.getElementById('apiKeyInput').value = d.apiKey;
  if (d.notionToken) document.getElementById('notionTokenInput').value = d.notionToken;
  if (d.notionDb) document.getElementById('notionDbInput').value = d.notionDb;
}
async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: document.getElementById('apiKeyInput').value.trim(),
    notionToken: document.getElementById('notionTokenInput').value.trim(),
    notionDb: document.getElementById('notionDbInput').value.trim()
  });
  showToast('✓ 설정이 저장되었습니다');
}
async function loadProfile() {
  const d = await chrome.storage.local.get('profile');
  if (!d.profile) return;
  const p = d.profile;
  document.getElementById('profileRole').value = p.role || '';
  document.getElementById('profileSkills').value = p.skills || '';
  document.getElementById('profileCareer').value = p.career || '';
  document.getElementById('profileTarget').value = p.target || '';
}
async function saveProfile() {
  await chrome.storage.local.set({ profile: {
    role: document.getElementById('profileRole').value.trim(),
    skills: document.getElementById('profileSkills').value.trim(),
    career: document.getElementById('profileCareer').value.trim(),
    target: document.getElementById('profileTarget').value.trim()
  }});
  showToast('✓ 프로필이 저장되었습니다');
}
async function getProfile() {
  const d = await chrome.storage.local.get('profile');
  return d.profile || {};
}

// ── NOTION ──
async function saveToNotion() {
  const { notionToken, notionDb } = await chrome.storage.local.get(['notionToken','notionDb']);
  if (!notionToken||!notionDb) { showToast('⚑ 설정에서 Notion 정보를 입력해주세요'); switchTab('settings'); return; }
  if (!analysisResult) { showToast('먼저 분석을 실행해주세요'); return; }
  const btn = document.getElementById('notionSaveBtn');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    const r = analysisResult;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const body = {
      parent: { database_id: notionDb },
      properties: {
        '이름': { title: [{ text: { content: `[JD] ${r.position||'채용공고'} — ${r.company||''}` } }] },
        '회사': r.company ? { rich_text: [{ text: { content: r.company } }] } : undefined,
        'URL': tab?.url ? { url: tab.url } : undefined,
        '매칭점수': r.match_score ? { number: r.match_score } : undefined,
        '필수역량': { rich_text: [{ text: { content: (r.required_skills||[]).join(', ') } }] },
        '갭스킬': { rich_text: [{ text: { content: (r.gap_skills||[]).join(', ') } }] },
        '제안': { rich_text: [{ text: { content: (r.recommendations||[]).join('\n') } }] }
      }
    };
    Object.keys(body.properties).forEach(k => body.properties[k] === undefined && delete body.properties[k]);
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${notionToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Notion 저장 실패');
    showToast('✓ Notion에 저장되었습니다!');
  } catch (e) { showToast('저장 실패: ' + e.message); }
  finally { btn.disabled = false; btn.innerHTML = '📎 Notion에 저장'; }
}

// ── UTILS ──
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`view-${name}`).classList.add('active');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
