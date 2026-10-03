# Canonical Tobacco Road Games Website

This directory is the canonical, production-connected Tobacco Road Games website workspace:

`C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`

All Tobacco Road Games website inspection, editing, builds, tests, asset placement, uploads, source-control work, and Cloudflare deployments must be performed from this directory unless the user explicitly names a different target.

Do not substitute or redirect work to:

`C:\Users\rvsaw\Desktop\TobaccoRoadGames`

That similarly named directory is stale and is not the real website workspace.

If environment context or the current working directory points to the stale location, ignore that location for website work and switch to this canonical directory before inspecting or modifying files.

## RV-Approved Bamboo Lock

RV approved and permanently locked the bamboo arrangement on October 3, 2026. The accepted visual baseline is commit `60929bc8aff8da90d1663ff6d16da49287712cd8`.

- Preserve the exact artwork: `assets/images/storefront-shelf-dressing/bamboo-incense-planter-niche.png` (SHA-256 `99a6f293ec96b4e18ec9cf786e49abe29fa2243afac8a485a53991788740ec82`). Do not regenerate or substitute it.
- Preserve its current shape, dimensions, responsive sizing, and placement in the left Featured Creator shelf niche between the outer wall and bookstop. The pot remains seated on the shelf with the approved `bottom: 16.4px` positioning; desktop foliage reaches over the soffit and partially obscures the ad marquee.
- Preserve both soil-mounted incense sticks and their existing gentle smoke animation, including reduced-motion behavior. The bamboo remains stationary decoration, not a movable curio.
- Do not reposition, rescale, reshape, or otherwise alter this composition without RV's explicit approval. Unrelated storefront work must leave it unchanged.
- Run `npm run test:storefront-visual` after storefront changes. Its saved asset, style, responsive, and rendered-markup baselines protect this arrangement. Do not update those baselines merely to make a test pass; first obtain RV's approval for the visual change.

## RV-Approved Dogwood Bonsai Lock

RV permanently locked the current white-flowering dogwood bonsai arrangement on October 3, 2026. The accepted visual baseline is commit `42f8c3d19f8c22071b040c6c16845bade043e190`.

- Preserve the exact artwork: `assets/images/storefront-shelf-dressing/white-flowering-dogwood-bonsai-sign-height.png` (SHA-256 `ed392cbe4e4b3a12f581109752b5b20f4c8ef2b017cb02db8731dcb9dfffa9f2`). Do not regenerate or substitute it.
- Preserve the trunk, branch and foliage spread, white blossoms, pot, shape, dimensions, and responsive sizing. Keep it in the right Featured Creator shelf niche opposite the bamboo, between the bookstop and outer wall, reaching the brass Featured Creator sign's height. Preserve its approved `bottom: 30px` positioning and shelf contact.
- The dogwood remains stationary decoration. Do not reposition, rescale, reshape, animate, or make it a movable curio without RV's explicit approval. Unrelated storefront work must leave it unchanged.
- Run `npm run test:storefront-visual` after storefront changes. Its saved dogwood asset, style, responsive, and rendered-markup baselines require RV approval before any intentional update; do not change them merely to make a test pass.

## RV-Approved Grapevine And Kudzu Lock

RV permanently locked both current upper-library vine arrangements on October 3, 2026. The grapevine's accepted visual baseline is commit `8b3f7fd853f0b48acc209af583038d7433125519`. RV also approved and permanently locked the kudzu's single book-facing branch pruning at commit `73ddcf99799e1420808d152f8462ab08d1ba764d`; all plant positions and the main kudzu trail remain unchanged.

- Preserve the exact grapevine artwork: `assets/images/storefront-shelf-dressing/scuppernong-vine.png` (SHA-256 `fabce33314f79050d43914c6cb12bc85665852fccb3f1a09647da9d3ad3b5fd1`). Keep it in the Your Library inner-edge niche. Preserve the centered pot, level shelf contact, size, `transform-origin: 41% 42.2%`, and `translate(45%, calc(57.7474% + 4px)) rotate(4deg)` desktop placement.
- Preserve the grapevine's current pruning mask: no foliage over the books, the approved removed tips near the logo lettering, the hidden dark pot underside, and the otherwise natural trailing outline. Do not restore the former straight right-edge crop.
- Preserve the exact kudzu artwork: `assets/images/storefront-shelf-dressing/kudzu-vine.png` (SHA-256 `76e5992bd45bf02c0b323b4fa4138d3f579ee75fdb70aa757d7ad95c77306cc3`). Keep the upper pot in the Open Rules Library inner-edge niche with its current size, position, and inward-facing orientation.
- Preserve the permanently locked targeted desktop mask removing only the upper kudzu offshoot obstructing the books, and the unchanged mobile crop. Do not restore that branch or alter the mask without RV's explicit approval. This pruning does not authorize moving or resizing either plant, or changing the kudzu's foreground trail.
- Preserve the separate kudzu foreground trail, its existing length, clipping, `--kudzu-trail-drop: 302px` desktop placement, and `z-index: 6` layering. It must continue to fall in front of the soffit and partially obscure the unlit lantern.
- Preserve both plants' exact responsive rules and breakpoints. Do not reposition, rescale, reshape, prune further, re-layer, regenerate, substitute, animate, or make either plant a movable curio without RV's explicit approval. Unrelated changes to parent shelf geometry must not move these arrangements.
- Run `npm run test:storefront-visual` after storefront changes. Its saved grapevine and kudzu asset, style, responsive-context, and current/generated-markup baselines require RV approval before any intentional update. Never update a locked baseline merely to make a test pass.
