# 먼 노드 연결선 잘림 수정 · 2026-10-09

원인: canvas-world 안의 SVG는 2000×1400 크기이며 기본 overflow가 hidden이다. 노드 DOM은 이 영역 밖에서도 표시되지만 SVG 경계 밖의 연결선과 클릭 영역은 잘렸다.

재현 파일: far-nodes.json. 노드 좌표는 (-700,-400), (2500,1700), (4000,2600), 연결은 두 개다. AI 요청 없이 로컬 작업실의 새 프로젝트로 가져왔다. 기존 사용자 프로젝트는 수정하지 않았다.

수정: globals.css의 `.canvas-world > .edge-layer { overflow: visible; }` 한 규칙. 실제 캔버스의 overflow:hidden은 유지되므로 작업 영역 밖으로 연결선이 새지 않는다. 노드·곡선 계산·클릭 해제 동작·인증 로직은 변경하지 않았다.

## 수정 전후 실제 관찰

- 수정 전: SVG overflow hidden. 두 번째 선의 곡선은 세계 좌표 (2690,1792.5)에서 (4000,2655.5)까지이며 SVG 경계 밖에 있다. 화면 중앙점 (659.05,589.90)의 elementFromPoint 결과는 canvas로, 선이 표시되지 않고 클릭 영역도 없었다.
- 수정 후: SVG overflow visible. 같은 배치의 두 연결선 모두 화면 중앙점에서 graph-edge-hit로 잡혔다.
- 음수 세계 좌표 (-408.17,-302.04)의 선 부분도 화면 좌표 (100.90,213.45)에서 graph-edge-hit로 잡혔다.
- 캔버스 이동 후 두 선의 클릭 영역이 유지됐다. 60% 확대 상태에서 세계 영역으로 이동한 뒤 두 번째 선의 화면 좌표 (824.30,660.70)도 graph-edge-hit였다.
- 확대해서 화면 밖으로 나간 선은 작업 영역에서 자연스럽게 잘린다. 확대 후 해당 영역으로 이동하면 정상 표시된다.
- before.png와 after-matched.png는 모두 1280×720, 같은 노드 배치의 비교다. after.png와 pan-zoom.png도 실제 수정 후 화면이다.

## 검증

- npm run build: 성공, TypeScript 통과.
- node --test --test-reporter=dot tests/*.test.cjs bridge/tests/*.test.js: 100개 통과, 종료 코드 0.
- 320/390/768/1280px에서 documentWidth와 viewport width 일치, 연결선 두 개 유지, SVG overflow visible, canvas overflow hidden.
- 브라우저 콘솔 오류 0개.
- 웹만 재시작해 반영했다. Bridge와 Cloudflare 터널은 재시작하거나 종료하지 않았다.

이전부터 있던 축소 버튼의 최소 배율 60% 동작은 이번 연결선 수정 범위에 포함하지 않았다. 캔버스 맞춤은 별도로 최소 15%를 사용한다.
