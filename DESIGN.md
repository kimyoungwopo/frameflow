# Frameflow web interface

## 1. Existing direction
The existing dark node workspace is the visual contract. This change improves execution and responsive behavior without a new brand or a desktop app.

## 2. Color
Canvas #161823; page #101116; header #15161d; panels #20232e; primary text #f4f5fb; secondary text #aeb2c2; accent #796cf0; running/success #55e0b2; error #ffabb4; border #45495d. Existing CSS owns these values.

## 3. Typography
System sans-serif with existing Inter fallback. Body and field copy 12–15px, project title 22px. Korean text wraps normally. Node labels retain the existing compact type.

## 4. Space and layout
Desktop: header 72px, workspace plus 368px inspector, canvas owns its panning. At 1000px and below, stack the workspace and inspector and let the document scroll. At 640px and below, wrap header actions; keep project, save, login and run reachable. The graph may pan horizontally; primary content must not overflow the page.

## 5. Reusable primitives
Existing primary/ghost buttons, node cards, input fields, status panel, toast, project menu and image viewer. Preserve their selectors. Buttons expose focus and disabled states. Status distinguishes idle, running, complete, error and login required. PROMPT and COMMAND configure operations rather than generating images themselves.

## 6. Interaction
Only image operations issue provider requests. Branches retain independent results. Authentication failure stops execution. Login polling stops when its dialog closes. Destructive project/image actions retain confirmation. Respect reduced-motion settings.

## 7. Depth and radius
Use the existing border and tonal surface system. Preserve existing 8–14px rounded controls and cards. No new decorative surfaces are required.

## 8. Accessibility and QA
Use visible keyboard focus, Korean labels, image alt text and live status. Check 390px, 768px and 1280px widths for reachable controls and readable inspector content. The graph remains a pointer-based editor; full keyboard graph editing is a pre-existing limitation, not a completion claim for this change.
