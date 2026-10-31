// Plain-assert checks for src/lib/pricingCalc.ts. Run: npx tsx scripts/pricingCalc.check.ts
import assert from 'node:assert/strict'
import { packRow, privateLabelTiers, costPerPiece, piecesPerStockUnit, stockToPiece, pieceToStock, defaultPackSizes, mapPerPiece } from '../src/lib/pricingCalc'
const near = (a: number, b: number, m = '') => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} != ${b}`)
const r = packRow(45, 0.05, 0.03538, 40)
near(r.price, 2.25, 'price'); near(r.cost, 1.5921, 'cost'); near(r.profit, 0.6579, 'profit'); near(r.commission, 0.26316, 'comm'); near(r.bgProfit, 0.39474, 'bg')
const t = privateLabelTiers(0.06, 0.03538, 40)
near(t[0].pricePerPiece, 0.06, 't0'); near(t[1].pricePerPiece, 0.069, 't1'); near(t[2].pricePerPiece, 0.081, 't2')
near(t[1].profitPerPiece, 0.069 - 0.03538); near(t[1].commission, (0.069 - 0.03538) * 0.4)
assert.equal(packRow(10, 0.01, 0.02, 40).commission, 0)
// UOM ladder
near(costPerPiece({ unit_of_measure: 'PKS', unit_cost: 1.5921, pieces_per_pack: 45, packs_per_case: 60 }).value, 0.03538, 'pks')
near(costPerPiece({ unit_of_measure: 'CASE', unit_cost: 38.5, pieces_per_pack: 1000, packs_per_case: 1 }).value, 0.0385, 'case')
near(costPerPiece({ unit_of_measure: 'EA', unit_cost: 0.025, pieces_per_pack: 1500 }).value, 0.025, 'ea')
assert.equal(piecesPerStockUnit({ unit_of_measure: 'CASE', pieces_per_pack: 48, packs_per_case: 6 }).pieces, 288)
assert.equal(piecesPerStockUnit({ unit_of_measure: 'PKS' }).known, false)
near(stockToPiece(12.6, { unit_of_measure: 'PKS', pieces_per_pack: 100 })!, 0.126); near(pieceToStock(0.126, { unit_of_measure: 'PKS', pieces_per_pack: 100 }), 12.6)
assert.deepEqual(defaultPackSizes({ pieces_per_pack: 45, packs_per_case: 60 }), [45, 2700])
near(mapPerPiece(0.06), 0.12)
console.log('pricingCalc: all checks passed')
