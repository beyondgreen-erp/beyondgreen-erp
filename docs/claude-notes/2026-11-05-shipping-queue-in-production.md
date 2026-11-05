# Shipping Queue: In Production orders removed (Nov 5, 2026)

## What Rudy reported
The Shipping Queue (`/production/shipping-queue`) showed an "In Production (7)" group with Pack & Ship
buttons. He wants only shippable orders there.

## What changed
- `SHIPPABLE` in `src/app/production/shipping-queue/page.tsx` no longer includes `In Production`
  (now: Ready to Ship, Prepped & Ready for Dispatch, Ready at Will Call, Partially Shipped). The page's
  description line was updated to match.
- `src/lib/orderFlow.ts`: the status change to `In Production` no longer auto-inserts a row into the
  legacy `shipping_queue` table (feeds `/sales/shipping-queue`). Only Ready to Ship and Ready at Will Call do.

## Why it was there
An earlier change added In Production so packers could print case labels during production (the
label tools live on the Shipping Queue). That convenience is gone; case labels are printed once the
order is Ready to Ship. If the team wants labels earlier, the right place is the work order board, not the queue.

## Learned
- Two shipping queue pages exist: `/production/shipping-queue` (in the nav, reads `sales_orders` by status)
  and the older `/sales/shipping-queue` (reads the `shipping_queue` table). Keep their status rules aligned.
- `npx tsc --noEmit` currently fails only on `@napi-rs/canvas` types (Walmart Weekly Report generator,
  commit 407e945); run `npm install` after pulling to clear it.
