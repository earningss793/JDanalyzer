# JD Analyzer — 채용공고 AI 분석기

## 설치 방법

1. Chrome 브라우저에서 `chrome://extensions` 접속
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장프로그램 로드** 클릭
4. 이 폴더(`jd-analyzer`) 선택

## 초기 설정

1. 확장 아이콘 클릭 → 사이드패널 열기
2. **설정 탭** → Claude API 키 입력 (https://console.anthropic.com)
3. **내 프로필 탭** → 직무/연차/스킬/경력 입력 후 저장

## 사용 방법

1. 채용공고 페이지로 이동 (사람인, 잡코리아, 원티드 등)
2. 사이드패널 → **분석 시작** 버튼 클릭
3. 핵심 역량, 갭 분석, 포트폴리오 전략 확인
4. Notion 연동 설정 시 **Notion에 저장** 가능

## Notion 연동 설정

1. https://www.notion.so/my-integrations 에서 Integration 생성
2. Integration Token 복사
3. 저장할 Notion DB에 Integration 연결 후 DB ID 복사
4. 설정 탭에 입력

## Notion DB 필수 컬럼

| 컬럼명 | 타입 |
|--------|------|
| 이름 | 제목 |
| 회사 | 텍스트 |
| URL | URL |
| 매칭점수 | 숫자 |
| 필수역량 | 텍스트 |
| 갭스킬 | 텍스트 |
| 제안 | 텍스트 |

## 지원 사이트

원티드, 사람인, 잡코리아, 링크드인, 각 기업 채용 페이지 등 모든 웹사이트에서 동작합니다.
