상태: 완료

## 원인

`page.tsx`의 `runWorkflow`가 새로 `encodeAnimation: encodeGif`를 전달하지만, `tests/workflow.test.cjs`가 page 일부를 VM으로 실행하면서 `encodeGif`를 context에 주입하지 않았다. 따라서 실행 시작 전에 `ReferenceError: encodeGif is not defined`가 발생했고, `runBatch`가 이를 이미지 작업 실패로 수집해 14개 테스트가 연쇄 실패했다.

## 수정

- 테스트 VM context에 결정론적 `encodeGif(frames, fps)` mock을 추가했다.
- 실제 provider 호출 없이 motion 실행 경로도 테스트 가능한 형태로 유지했다.
- 임시 root-cause 계측 코드는 원복했다.

## 검증

- `node --test tests/workflow.test.cjs` → 19개 통과
- `npm test` → 178개 통과, 0개 실패
- `npm run agent:check` → 통과
- `npm run typecheck` → 통과
- `npm run build` → 통과
