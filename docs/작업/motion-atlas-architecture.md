# 모션별 atlas 구조 전환

## 결정

모션마다 별도 provider 요청을 보낸다. 한 요청에는 `idle`, `waving`, `jumping`을 섞지 않는다.

각 motion 노드는 원본 캐릭터 1장과 한 가지 모션 지시를 받아, 가로 방향의 동일 셀 atlas 1장을 요청한다. 브라우저가 atlas를 동일 폭 셀로 결정적으로 분리하고, 셀 개수와 GIF/APNG 인코딩 결과를 검증한다.

## 계약

- atlas layout: `horizontal_equal_cells`
- 프레임 수: 4~12
- 한 행만 허용
- 셀마다 완전한 full-canvas 캐릭터 1개
- 텍스트·라벨·UI·워터마크·여러 모션 혼합 금지
- 원본 캐릭터·팔레트·앵커·눈·앞발 구조 보존
- 단순한 32×32 또는 64×64 논리 픽셀 디자인을 기준으로 함
- 큰 픽셀 클러스터와 명확한 실루엣을 우선함
- 팔레트는 약 6~8개의 단색으로 제한함
- 최종 작은 표시 크기에서도 머리·눈·앞발·꼬리가 읽혀야 함
- 고해상도 일러스트·사실적인 털·부드러운 음영·벡터풍 재해석 금지
- nearest-neighbor 기반 하드 픽셀 엣지, blur·gradient·반투명 painted edge 금지
- 모션은 카메라 이동이 아닌 작은 자세 변화로 읽혀야 함

## 구현

- `workflow-engine.ts`: motion 실행을 프레임별 provider 호출에서 atlas 1회 호출 + 셀 분리로 전환
- `page.tsx`: horizontal equal-cell atlas splitter 추가
- planner contract와 `shared/ai-harness.json`: one-motion-per-request와 atlas layout 명시
- 회귀 테스트: provider 요청 1회, 정확한 셀 수, GIF 입력 프레임 검증
