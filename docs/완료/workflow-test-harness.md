# workflow.test VM harness 정합성 완료

상태: 완료
원본 작업: `docs/진행중/workflow-test-harness.md`

## 원인

`page.tsx`의 `runWorkflow`가 `encodeAnimation: encodeGif`를 사용하지만, `tests/workflow.test.cjs`가 page 일부를 VM으로 실행하면서 `encodeGif`를 context에 주입하지 않았다. 실행 전 `ReferenceError: encodeGif is not defined`가 발생했고, `runBatch`가 이미지 실행 실패로 처리해 14개 테스트가 연쇄 실패했다.

## 수정

- 테스트 VM context에 결정론적 `encodeGif(frames, fps)` mock 추가
- 실제 provider 호출 없이 motion 실행 경로 검증 가능
- 임시 root-cause 계측 코드는 원복
- 진행중 문서는 `상태: 완료`로 보존

## 검증

- `node --test tests/workflow.test.cjs` → 19개 통과
- `npm test` → 178개 통과, 0개 실패
- `npm run agent:check` → 통과
- `npm run typecheck` → 통과
- `npm run build` → 통과
