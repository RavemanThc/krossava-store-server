const brands = ['Calvin Klein','Baas','The North Face','New Balance','Under Armour','On Running','DC Shoes','Timberland','Columbia','Salomon','Lacoste','Merrell','Reebok','Converse','Adidas','Asics','Armani','HOKA','Nike','Vans','UGG'];
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim();
export function categoryBrand(category) {
  return brands.find(brand => brand.toLowerCase() === normalize(category).toLowerCase()) || '';
}
const families = {
  Nike:['Air Jordan 4','SB Dunk Low','SB Dunk High','M2K Tekno','Initiator','Cortez','Air Force 1','Air Max 95','Air Max 97','Air Max 90','Air Max 270','Air Max Plus','Air Max TN','Air Max Moto 2K','Air Jordan 1','Jordan 1','P-6000','Zoom Vomero 5','Dunk Low','Dunk High'],
  Adidas:['Superstar','Samba','Gazelle','Campus 00s','Campus','Handball Spezial','Terrex Swift R3','Terrex Swift R2','Terrex Swift R'],
  'DC Shoes':['Court Graffik'],
  Columbia:['GTX BOA'],
  'New Balance':['991v2','990v6','990v3','1906D','1906A','740','758','471','1064','2010','204L','ABZORB 2000','880','9060','1906R','2002R','530','550','574','327','1000','725','990','992','993'],
};
const variantWords = /\b(?:gtx|gore[ -]?tex|termo|thermo|thermal|fur|fleece|winter|big\s+size|all\s+(?:black|white)|black|white|grey|gray|beige|blue|navy|red|green|olive|khaki|brown|pink|purple|orange|yellow|silver|gold|cream|ivory|burgundy|mint|mauve|phantom|coyote|sand|army|dark|light|triple|off[ -]?white|reflective|milk|taupe|moss|mustard|pale|plum|lavender|neon|ocean|violet)\b/i;
export function classifyProduct(product) {
  const name=normalize(product.name || product.title);
  const brand=brands.find(b=>name.toLowerCase().startsWith(b.toLowerCase()+' ')) || (/^DC\s/i.test(name) ? 'DC Shoes' : categoryBrand(product.category));
  if(!brand)return {brand:'',model:''};
  let rest=name.toLowerCase().startsWith(brand.toLowerCase()+' ') ? name.slice(brand.length).trim() : '';
  if (brand === 'DC Shoes' && /^DC\s/i.test(name)) rest = name.slice(3).trim();
  if (brand === 'Adidas') rest = rest.replace(/^Originals\s+/i, '').replace(/^Spezial\b/i, 'Handball Spezial');
  if (brand === 'Nike') rest = rest.replace(/^M\s+(?=Air Max)/i, '');
  if (brand === 'New Balance') rest = rest.replace(/^ML574\b/i, '574');
  if (brand === 'DC Shoes' && /\bCourt Graffik\b/i.test(rest)) rest = 'Court Graffik';
  const known=[...(families[brand] || [])].sort((a,b)=>b.length-a.length).find(m=>rest.toLowerCase()===m.toLowerCase() || rest.toLowerCase().startsWith(m.toLowerCase()+' '));
  const model=known || rest.split(variantWords)[0].replace(/[\s,/-]+$/,'').trim();
  return {brand,model};
}
