import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSizeChart,latestSizeCharts} from '../src/services/import/sizeChart.js';

test('supplier size chart keeps explicit measurements and normalizes article and decimals',()=>{
 assert.deepEqual(parseSizeChart('Артикул А6128\nРозмірна сітка:\n▫️41 = 26 см;\n▫️42 = 26,5 см;\n43 — 27 cm'),{
  article:'A6128',rows:[{size:'41',cm:26},{size:'42',cm:26.5},{size:'43',cm:27}]
 });
});
test('rejects ambiguous products, conflicting measurements and size ranges without measurements',()=>{
 for(const text of ['A6128 B1234\n41=26 см\n42=27 см','A6128\n41=26 см\n41=27 см','A6128 Розміри 41-45','41=26 см\n42=27 см','A6128\n41=90 см\n42=27 см'])assert.equal(parseSizeChart(text),null);
});
test('uses the newest explicit chart per article, never merges messages',()=>{
 const charts=latestSizeCharts([{id:2,text:'A6128 41=26 см 42=27 см'},{id:3,text:'A6128 41=26.5 см 42=27.5 см'},{id:4,text:'A6128 Немає в наявності'}]);
 assert.equal(charts.get('A6128').messageId,'3');assert.equal(charts.get('A6128').rows[0].cm,26.5);
});

test('labelled article ignores unrelated price codes',()=>{
 assert.equal(parseSizeChart('Артикул A6128\nЦіна N1900\n41=26 см\n42=27 см').article,'A6128');
});
