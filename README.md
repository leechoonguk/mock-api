# Mock API

Postman Mock Server처럼 동작하는 로컬 목 API 서버와 관리자 화면입니다.

- **프로젝트**는 고유한 `slug`를 가지며 여러 **엔드포인트**를 소유합니다.
- **엔드포인트**에는 메서드, 경로 패턴(`/users/{id}`), 상태코드, 응답 헤더, 바디 템플릿, 지연 시간을 지정합니다.
- `/mock/{slug}/{path}`로 들어온 요청은 해당 프로젝트에서 켜져 있는 엔드포인트와 매칭되어 등록된 응답을 돌려받습니다.
- 존재하는 프로젝트로 들어온 요청은 매칭 여부와 관계없이 모두 **요청 로그**에 남습니다.

인증이 없으므로 백엔드는 `127.0.0.1`에만 바인딩합니다. 외부에 노출하지 마세요.

## 스택

|영역|구성|
|---|---|
|백엔드|Python 3.14, uv, FastAPI, SQLAlchemy 2.0(async) + aiosqlite, Alembic, Pydantic 2, pydantic-settings, structlog|
|프론트엔드|Vite, React 19, TypeScript, MUI 7, TanStack Query 5, react-hook-form + yup, axios, i18next(ko/en)|
|DB|SQLite 파일 `backend/data/mock.db`|
|하네스|`.omp/` (omp 훅, 룰, ast-grep 규칙)|

## 요구 사항

- [uv](https://docs.astral.sh/uv/) (Python 버전은 `backend/.python-version`을 따라 uv가 받아 옵니다)
- Node.js 22 이상, npm
- `make`, `lsof`

## 빠른 시작

```bash
cp .env.example .env                    # BACKEND_PORT=47821, FRONTEND_PORT=47823
cp backend/.env.example backend/.env
make install                            # uv sync + npm install
make dev                                # 마이그레이션 적용 후 백엔드·프론트를 백그라운드로 실행
```

|서비스|주소|로그|
|---|---|---|
|관리자 화면|http://localhost:47823|`/tmp/mock-api-frontend.log`|
|백엔드 API|http://127.0.0.1:47821 (OpenAPI 문서: `/docs`)|`/tmp/mock-api-backend.log`|

중지는 `make down`입니다.

Vite가 `/api`, `/mock`, `/health`를 백엔드로 프록시합니다. 그래서 관리자 화면에서 보이는 목 URL의 기본값은 `http://localhost:47823/mock/{slug}`입니다. 백엔드 주소를 직접 쓰려면 `frontend/.env`에 `VITE_MOCK_ORIGIN=http://localhost:47821`을 넣으세요(`frontend/.env.example` 참고).

### 사용 예

```bash
# 프로젝트 생성
curl -s -X POST localhost:47821/api/v1/project/ \
  -H 'content-type: application/json' -d '{"name":"Demo","slug":"demo"}'

# 엔드포인트 생성 ({project_id}는 위 응답의 id)
curl -s -X POST localhost:47821/api/v1/project/{project_id}/endpoints \
  -H 'content-type: application/json' \
  -d '{"method":"GET","path":"/users/{id}","status_code":200,"body":"{\"id\":\"{{path.id}}\",\"at\":\"{{now}}\"}"}'

# 목 호출
curl -i localhost:47821/mock/demo/users/7
# HTTP/1.1 200 OK
# content-type: application/json
# {"id":"7","at":"2026-10-16T01:29:29Z"}
```

`api/` 아래에 VS Code REST Client용 `.http` 파일이 있습니다. 쓰기 전에 `api/.env.example`을 `api/.env`로 복사하세요.

## 목 동작 규칙

### 경로 매칭
- 경로는 정규화됩니다. 앞에 `/`가 없으면 붙이고, 끝의 `/`는 떼고(루트 제외), `//`는 하나로 합칩니다.
- 세그먼트가 정확히 `{name}` 형식이면 파라미터이고, 비어 있지 않은 아무 세그먼트 하나와 매칭됩니다. 나머지 세그먼트는 대소문자를 구분해 그대로 비교합니다. 와일드카드와 정규식은 지원하지 않습니다.
- 메서드는 `GET POST PUT PATCH DELETE HEAD OPTIONS ANY` 중 하나입니다. `ANY`는 모든 메서드와 매칭됩니다.
- 여러 엔드포인트가 매칭되면 다음 순서로 고릅니다.
  1. 메서드가 정확히 같은 것이 `ANY`보다 우선합니다.
  2. 앞쪽 세그먼트부터 비교해 literal이 파라미터보다 우선합니다.
  3. 끝까지 같으면 먼저 만든 것이 이깁니다.
- `HEAD` 요청은 `HEAD` 엔드포인트가 없으면 `GET`으로 한 번 더 찾고, 응답 바디는 비웁니다.
- 꺼진(`enabled=false`) 엔드포인트는 무시합니다.

### 바디 템플릿
템플릿은 응답 **바디에만** 적용됩니다. 헤더와 상태코드에는 적용되지 않습니다.

|토큰|값|
|---|---|
|`{{path.id}}`|경로 파라미터 (URL 디코딩된 값)|
|`{{query.page}}`|쿼리 파라미터 (같은 키가 여러 개면 첫 값)|
|`{{headers.x-user}}`|요청 헤더 (이름 대소문자 무관)|
|`{{body.user.name}}`|요청 바디를 JSON으로 파싱해 `.`으로 내려간 값 (숫자 세그먼트는 배열 인덱스)|
|`{{now}}`|현재 UTC 시각, ISO 8601 (`...Z`)|
|`{{uuid}}`|무작위 UUID v4|

- 값이 없거나 JSON 파싱에 실패하면 빈 문자열이 됩니다.
- 객체와 배열은 JSON 문자열로, bool은 `true`/`false`로 들어갑니다.
- 위 형식이 아닌 `{{...}}`는 그대로 남습니다.

### 응답
- `content-type`을 지정하지 않으면, 렌더된 바디가 JSON이면 `application/json`, 아니면 `text/plain; charset=utf-8`을 붙입니다.
- 지연(`delay_ms`, 0~30000)은 응답 직전에 적용됩니다.
- 엔드포인트에 지정한 헤더가 우선합니다. 보안 헤더와 `X-Request-ID`는 값이 없을 때만 채웁니다.
- `/mock/`은 어느 오리진에서든 호출할 수 있습니다. CORS는 `*`이고 응답 헤더를 모두 노출하며, CSRF 검사에서 제외됩니다.
- 브라우저 preflight(`OPTIONS` + `Access-Control-Request-Method`)는 CORS 미들웨어가 먼저 응답하므로 `OPTIONS` 목 엔드포인트까지 오지 않습니다.

|상황|응답|로그|
|---|---|---|
|매칭됨|등록된 상태코드·헤더·바디|남음 (`matched=true`)|
|프로젝트는 있는데 매칭 없음|404 `{"code":"mock_not_matched", "method", "path", ...}`|남음 (`matched=false`)|
|프로젝트 없음|404 `{"code":"not_found", ...}`|남지 않음|

요청 로그는 프로젝트마다 최신 1000건만 보관하고, 요청 바디는 64 KiB까지만 저장합니다.

## 관리 API

모든 관리 API는 `/api/v1` 아래에 있습니다.

|메서드|경로|설명|
|---|---|---|
|POST / GET|`/project/`|생성(201) / 목록 (`offset`, `limit`, `name`, `sort`=`name\|slug\|created_at`, `order`)|
|GET / PATCH / DELETE|`/project/{project_id}`|조회 / 수정 / 삭제 (엔드포인트와 로그도 함께 삭제)|
|POST / GET|`/project/{project_id}/endpoints`|엔드포인트 생성 / 목록|
|GET / PATCH / DELETE|`/project/{project_id}/endpoints/{endpoint_id}`|엔드포인트 조회 / 수정 / 삭제|
|GET / DELETE|`/project/{project_id}/logs`|로그 목록(최신순) / 전체 비우기|
|GET|`/project/{project_id}/logs/{request_log_id}`|로그 상세 (요청 헤더와 바디 포함)|
|GET|`/health`|DB까지 확인하는 헬스체크 (`/api/v1` 밖)|

응답 형식은 다음과 같습니다.
- 목록은 `{"items": [...], "total": N}`이고, 삭제는 200 `{"ok": true}`입니다.
- 에러 바디는 `{"detail", "code", "request_id"}`입니다. `code`는 `not_found`, `conflict`(slug나 메서드+경로 중복), `stale_version`, `service_unavailable`, `mock_not_matched` 중 하나입니다.
- 입력 검증 실패는 FastAPI 기본 422 형식입니다.

## 관리자 화면

- **프로젝트 목록**: 이름 필터, 이름 인라인 편집, 삭제, 생성 다이얼로그가 있습니다. slug는 직접 고치기 전까지 이름에서 자동으로 만들어집니다.
- **프로젝트 상세 다이얼로그** (URL `?detail=<id>&tab=...`)
  - **엔드포인트 탭**: 목록, 켜기/끄기 스위치, 편집·테스트·삭제 패널
  - **로그 탭**: 3초마다 갱신하고, 행을 누르면 요청 헤더와 바디를 보여 줍니다.
- **테스트 패널**: 저장된 엔드포인트로 실제 요청을 보내 상태코드, 걸린 시간, 응답 헤더, 바디를 보여 줍니다. 저장하지 않은 변경은 반영되지 않습니다.
- 언어(ko/en)와 테마는 상단 설정에서 바꿉니다.

## 개발

모든 도구는 make 타깃으로 실행합니다. `make help`, `make -C backend help`, `make -C frontend help`로 전체 목록을 볼 수 있습니다.

|명령|용도|
|---|---|
|`make verify`|**전체 게이트**: 하네스 체크 전부 + 백엔드 verify + 프론트 verify. 반드시 프로젝트 루트에서 실행|
|`make -C backend test`|pytest (커버리지 100% 미만이면 실패)|
|`make -C backend test-fast t="tests/api/test_mock.py"`|커버리지 없이 일부만 실행|
|`make -C backend lint` / `typecheck` / `fix`|ruff / pyright / 자동 수정|
|`make -C backend migrate-gen m="add something"`|모델 변경으로 Alembic 리비전 생성 (리비전 번호는 정수로 자동 증가)|
|`make migrate`|로컬 DB를 head로 올림|
|`make -C backend migrate-check`|임시 DB에 head를 적용해 모델과 마이그레이션이 어긋나는지 검사|
|`make -C frontend lint` / `typecheck` / `build`|eslint / tsc / 빌드|

마이그레이션 파일은 손으로 만들지 말고 `migrate-gen`으로만 만드세요. 서버를 시작할 때(`scripts/start.sh`) `alembic upgrade head` 다음에 `alembic check`를 실행하므로, 모델과 마이그레이션이 어긋나면 서버가 뜨지 않습니다.

### 디렉터리 구조

```
backend/
  app/
    core/          설정, DB 엔진(SQLite foreign_keys=ON), 예외와 핸들러, 로깅, Page
    engine/        DB와 무관한 순수 함수: matcher.py(경로 매칭), templating.py(바디 템플릿)
    models/        project, endpoint, request_log (테이블 하나당 파일 하나)
    schemas/       요청/응답 Pydantic 스키마
    repositories/  테이블당 하나, flush만 함
    services/      트랜잭션과 도메인 규칙. mock.py가 요청을 매칭하고 로그를 남김
    dependencies/  DI 별칭 (세션, 서비스, 쿼리 파라미터)
    routers/       health, project(/api/v1), mock(/mock)
    main.py        미들웨어와 라우터 등록
  alembic/         마이그레이션
  tests/           app/ 구조를 그대로 따르는 테스트
frontend/src/
  types/ lib/api/ hooks/ components/ layouts/ sections/project/ pages/ routes/ locales/ theme/ utils/
api/               REST Client .http 파일
.omp/              omp 하네스 (훅, 룰, ast-grep, continuity 확장, 스킬)
```

계층 규칙은 다음과 같습니다.
- 라우터는 서비스만 호출합니다.
- 서비스는 리포지토리를 조합하고, 다른 서비스를 주입하지 않습니다.
- 쓰기 트랜잭션(`session.begin()`)은 서비스의 create/update/delete 메서드에서만 엽니다.
- 예외는 `app/core/exceptions.py`의 클래스만 사용합니다(`HTTPException` 사용 금지).

프론트엔드 규칙은 다음과 같습니다.
- HTTP 호출은 `lib/api/client.ts`에서만, 백엔드 경로 문자열은 `lib/api/endpoints.ts`에서만 씁니다.
- 화면에 보이는 문구는 모두 `locales/`에 두고, ko와 en의 키가 같아야 합니다.

## 하네스 (`.omp/`)

[oh-my-pi](https://github.com/can1357/oh-my-pi)(omp) 에이전트용 하네스이며, `fast-api-standard` 레퍼런스에서 범용 부분만 이 프로젝트에 맞게 옮겨 왔습니다.

- **pre 훅**: 기존 파일을 통째로 덮어쓰는 쓰기, make를 거치지 않는 도구 실행(bare `pytest`, `npx tsc` 등), 선언되지 않은 디렉터리에 파일 만들기, 사용자 동의 없는 커밋과 푸시를 막습니다.
- **post 체크**: 레이아웃, 예외, 트랜잭션, 네이밍, 테스트 구조, 미들웨어, 프론트 계층과 i18n 등을 검사합니다. 편집할 때마다 자동으로 돌지 않고 `make verify`에서 한 번에 실행됩니다(`.omp/config.yml`의 `disabledExtensions`).
- **continuity 확장**: 마지막 변경 이후 루트 `make verify`가 통과하지 않았으면 에이전트가 작업을 끝내지 못하게 합니다.
- **룰**: `.omp/rules/*.md`에 각 체크가 집행하는 규칙을 문서로 둡니다. `.omp/RULES.md`는 항상 적용되는 규칙입니다.

커밋과 푸시는 `make commit m="..."`, `make push`로 합니다. 둘 다 `make verify`를 먼저 실행합니다.

## 포트 변경

47821이나 47823이 이미 쓰이고 있으면 아래를 함께 바꾸세요.

- 루트 `.env`의 `BACKEND_PORT`, `FRONTEND_PORT`
- `frontend/vite.config.ts`의 `server.port`와 프록시 대상
- `backend/.env`의 `CSRF_TRUSTED_ORIGINS`
- (설정했다면) `frontend/.env`의 `VITE_MOCK_ORIGIN`
