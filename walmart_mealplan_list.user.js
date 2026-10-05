// ==UserScript==
// @name         Walmart Meal-Plan Shopping Pilot
// @namespace    https://github.com/JPInert/userscripts
// @version      1.43.0
// @description  Walks a fixed grocery list one item at a time on Walmart, highlights the matching product tile, records what you added, and audits the cart against the list. You click Add yourself; the script never does.
// @author       JPInert
// @match        https://www.walmart.com/*
// @match        https://walmart.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/JPInert/userscripts/main/walmart_mealplan_list.user.js
// @updateURL    https://raw.githubusercontent.com/JPInert/userscripts/main/walmart_mealplan_list.user.js
// ==/UserScript==
//
// READ-ONLY BY DESIGN: this script never clicks Add, never submits, never
// fetches or polls walmart.com. It reads the DOM of pages you opened and only
// navigates when you press a button in its own panel. Walmart blocks
// automated browsing, and every cart change here is a real human click.
//
// The LIST below is my own two-person meal plan. Edit it for yours:
// [qty, exact title, expected $ for the line, flag, search query, reject words]
//   flag 'w' = sold by weight (price checked loosely), '?' = never priced at
//   Walmart (size and price checks off). A tile containing any reject word is
//   never matched.
(function () {
  'use strict';

  const P0 = location.pathname;
  const onProduct = P0.startsWith('/ip/');
  const onCart    = P0.startsWith('/cart');
  if (!P0.startsWith('/search') && !P0.startsWith('/browse') && !onProduct && !onCart) return;

  const LIST = [
    [1,'Fresh Yellow Onions, 3 lb Bag',3.24,'','yellow onions 3 lb bag','green,powder,rings,frozen,diced'],
    [1,'Fresh Whole Russet Potatoes, 5 lb Bag',4.37,'','russet potatoes 5 lb bag','sweet,instant,frozen,mashed,idaho,10 lb,8 lb,jumbo,organic,yellow,red'],
    [1,'Fresh Green Seedless Grapes, 2 lb',3.54,'','green seedless grapes 2 lb','organic,tomato,juice,jelly'],
    [1,'Fresh Gala Apples, 3 lb Bag',3.24,'','gala apples 3 lb bag','sauce,juice,slices'],
    [6,'Fresh Banana, Each',1.20,'','bananas','organic,bunch,chips,bread,pudding,dried,plantain,baby'],
    [1,'Freshness Guaranteed Boneless, Skinless Chicken Breasts, Tray',15.68,'w','boneless skinless chicken breast tray','frozen,tenderloin,thigh,nugget,strips,breaded,thin,sliced','',
     'Pick the listing whose <b>avg price is near $15.68</b> &mdash; about a 6 lb tray. The bags need 6.1 lb; the 09-11 listing averaged 4.6. Walmart picks the tray, the receipt settles it.'],
    [1,'Chuck Roast, Choice Angus Beef, 1.6 - 2.85 lb',22.71,'w','beef chuck roast choice angus','ground,stew,cubed,tender roast,shoulder,rump,deli,sliced,lunchmeat,pot roast seasoning,grass fed,marketside','',
     'The <b>heaviest listing</b> &mdash; avg price near $22.71, about 2.85 lb. The leftovers are Sunday lunch.'],
    [1,'Great Value Beef Broth, 32 oz Carton',1.50,'','great value beef broth 32 oz','chicken,vegetable,bone,unsalted,organic,low sodium,swanson,48 oz,bouillon'],
    [1,'Great Value Onion Recipe Soup & Dip Mix, 2 oz',0.98,'','great value onion soup dip mix 2 oz','lipton,golden,mushroom,vegetable,beefy,6 pack,4 pack,canned'],
    [1,'Great Value All Natural Boneless Skinless Chicken Breasts, 3 lb (Frozen)',9.47,'','great value boneless skinless chicken breasts 3 lb frozen','breaded,tenders,tenderloins,strips,thin,sliced,nuggets,popcorn,8 lb,fully cooked,grilled,fresh,tray','',
     'The <b>3 lb FROZEN bag</b> &mdash; bag G, Wednesday&rsquo;s chicken pasta in week 2. Not the 8 lb bag, not tenders, not the fresh tray.'],
    [1,'80% Lean / 20% Fat Ground Beef Chuck, 3 lb Roll',18.83,'','ground beef 80 20 roll 3 lb','patties,frozen,73,27'],
    [1,'Top Sirloin Beef Steak, Family Pack',15.52,'w','top sirloin steak family pack','ground,tips,marinated,frozen,ribs'],
    [3,'Great Value Milk Whole Vitamin D, Half Gallon, 64 fl oz',5.19,'','great value milk whole half gallon','chocolate,almond,oat,soy,lactose,buttermilk,evaporated'],
    [2,'Great Value Mild Cheddar Finely Shredded Cheese, 16 oz Bag',6.96,'','great value mild cheddar finely shredded 16 oz','sharp,block,sliced,colby,singles,american'],
    [1,'Great Value Low-Moisture Part-Skim Mozzarella Shredded Cheese, 8 oz Bag',1.97,'','great value mozzarella shredded 8 oz','16 oz,32 oz,block,chunk,sliced,deli,pizza,blend,reduced fat,whole milk,string,fresh'],
    [1,'Great Value Original Sour Cream, 16 oz Tub',1.84,'','great value original sour cream 16 oz','dip,light'],
    [1,'Great Value Singles American Cheese, 12 oz, 16 Slices',1.88,'','great value american cheese singles 16 slices','24 oz,48 oz,32 count,72 count,deli style,provolone,swiss,pepper jack,colby'],
    [4,'Great Value Frozen Broccoli Florets Steamable Bag, 12 oz',4.64,'','great value frozen broccoli florets 12 oz','cheese,sauce,normandy'],
    [4,'Great Value Whole Kernel Corn, 12 oz Steamable Bag',3.92,'','great value whole kernel corn 12 oz frozen steamable','golden,canned,cream,creamed,cob,chips'],
    [1,'Great Value Sliced Strawberries, 64 oz',9.82,'','great value sliced strawberries 64 oz','preserves,jam,organic'],
    [1,'Great Value Creamy Peanut Butter, 40 oz',3.98,'','great value creamy peanut butter 40 oz','crunchy,chunky,natural'],
    [1,'Great Value 100% Whole Grain Old Fashioned Oats, 42 oz',4.18,'','great value old fashioned oats 42 oz','instant,quick,packets,steel'],
    [4,'Great Value Cream Of Chicken Condensed Soup, 10.5 oz',2.96,'','great value cream of chicken condensed soup','mushroom,celery,broccoli,noodle'],
    [4,'Great Value Diced Tomatoes in Tomato Juice, 14.5 oz Can',3.84,'','great value diced tomatoes 14.5 oz','paste,soup,grape,cherry'],
    [1,'Great Value Black Beans, 4 lb',4.98,'','great value black beans 4 lb','refried,baked,pinto,canned,15 oz,15.5 oz'],
    [1,'Great Value Long Grain Enriched Rice, 20 lb',11.46,'','great value long grain enriched rice 20 lb','brown,instant,minute,jasmine,basmati'],
    [1,'Great Value White Hamburger Buns, 11 oz, 8 Count',1.48,'','great value white hamburger buns 8 count','hot dog,shelf stable,wheat,brioche,potato,slider,sesame,12 count'],
    [1,'Great Value Original BBQ Sauce, 18 oz',1.77,'','great value original bbq sauce 18 oz','honey,wing,hickory,6 pack,3 pack,kraft,sweet baby,82.5 oz,dipping,secret'],
    [1,'Great Value Penne Pasta, 16 oz',1.24,'','great value penne pasta 16 oz','whole wheat,protein,garden,gluten,organic,rigate,mostaccioli'],
    [2,'Great Value Ziti, 16 oz',2.48,'','great value ziti 16 oz','whole wheat,protein,garden,gluten,organic,penne,rigatoni'],
    [1,'Great Value Traditional Pasta Sauce, 24 oz',1.97,'','great value traditional pasta sauce 24 oz','organic,meat,alfredo,mushroom,cheese,garden,basil,garlic,marinara,ragu,prego'],
    [1,'Great Value Small Fajita Flour Tortillas, 22.5 oz, 20 Count',2.12,'','great value fajita flour tortillas 20 count','corn,chips,shells,crispy'],
    [2,'Great Value Thick & Chunky Mild Salsa, 16 oz',3.94,'','great value thick and chunky salsa mild 16 oz','pace,tostitos,verde,queso,ranch,medium,hot,24 oz,restaurant,con queso'],
    [1,'Great Value Mayonnaise, 30 fl oz',2.97,'','great value mayonnaise 30 fl oz','miracle,olive,avocado'],
    [1,'Great Value Vegetable Oil, 48 fl oz Bottle',3.82,'','great value vegetable oil 48 fl oz','olive,canola,coconut,spray,peanut'],
    [1,'Great Value Honey, 12 oz Plastic Bear',3.54,'','great value honey 12 oz bear','mustard,roasted,graham,cereal,barbecue,granola,busy bee,raw,local,manuka,clover'],
    [1,'Great Value Oats & Honey Granola, 11 oz',2.67,'','great value granola 11 oz','bar,bars,cereal,yogurt'],
    [2,'Great Value Vanilla Pudding Cups, 4 pk',2.90,'?','great value vanilla pudding cups 4 count','jell o,mix,chocolate,banana,instant,6 pack,12 pack'],
    [1,'Heavy duty aluminum foil, 50 sq ft',5.44,'?','heavy duty aluminum foil 50 sq ft','non stick,parchment,plastic wrap,pans'],
    [1,'Gallon freezer bags, 30+ ct',5.24,'?','gallon freezer bags slider','sandwich,snack,quart,storage bags,vacuum seal'],
    [1,'Quart freezer bags, 30+ ct',3.12,'?','quart freezer bags','sandwich,snack,gallon,storage bags,vacuum seal'],
    [1,'Great Value Chili Powder, 3 oz',1.78,'?','great value chili powder','flakes,cayenne,chipotle,seasoning mix,chili beans'],
    [1,'Great Value Ground Cumin, 2.5 oz',2.12,'?','great value ground cumin','seed,curry,coriander,turmeric'],
    [1,'Great Value Garlic Powder, 3.4 oz',2.12,'?','great value garlic powder','garlic salt,minced,fresh,onion powder'],
    [1,'Great Value Ground Black Pepper, 3 oz',1.98,'?','great value ground black pepper','whole,peppercorn,lemon pepper,red pepper,white'],
    [1,'Great Value Iodized Salt, 26 oz',0.62,'?','great value iodized salt 26 oz','sea salt,kosher,garlic salt,pink,onion salt'],
    [1,'Louisiana Hot Sauce, 12 oz',1.48,'?','louisiana hot sauce 12 oz','wing,buffalo,sriracha,taco,chili garlic'],
  ];

  const SETUP = [
    [1,'Instant Pot Rio 6 Qt, 112-0312-01',129.99,'','instant pot rio 6 quart 112-0312-01','chef,rio chef,chef series,ceramic,nonstick,wide,plus,pro,duo plus,duo crisp,duo nova,duo gourmet,3 quart,8 quart,lid only,accessories,liner','',
     'The tile must say <b>Rio</b> AND <b>112-0312-01</b> (Walmart calls it "Rio Duo"). Not the Chef Series &mdash; that pot is ceramic.'],
    [1,'Square metal cake pan, 9 x 9 x 2 in',7.00,'?','9 x 9 metal square cake pan','glass,silicone,ceramic,springform,muffin,loaf,8 x 8,9 x 13,set,2 pack,disposable'],
    [1,'Instant-read digital thermometer',15.00,'?','instant read meat thermometer','oven safe,candy,infrared,fridge,freezer,wireless'],
    [1,'Hand vegetable chopper',15.00,'?','vegetable chopper hand press','electric,mandoline,food processor,slicer only'],
    [1,'Plastic cutting board, small',5.00,'?','plastic cutting board small','wood,bamboo,glass,marble,set of 6'],
    [1,'Food storage containers with lids, set',9.96,'?','food storage containers with lids set','glass,baby,cereal,pantry,bins,shoe'],
    [1,'Wide-mouth pint jars, 2 pk',5.96,'?','wide mouth pint mason jars','half gallon,quart,lids only,candle,plastic','',
     'Two jars total, one each. Take the <b>smallest pack</b> &mdash; a 12-pack is fine if that is all there is, but buy ONE.'],
    [1,'Permanent marker',1.98,'?','sharpie permanent marker','highlighter,dry erase,paint,chalk'],
  ];

  const FIXES = [
    [1,'Chicken tray &mdash; take one near 6 lb',15.68,'w','boneless skinless chicken breast tray','frozen tenderloin thigh nugget strips breaded','bigger',
     'Yours rang $11.92 at $2.57/lb = 4.6 lb. The dinners need 6.1. Tray runs 2.75&ndash;7.0 lb, so pick a heavy one. This one costs MORE, about +$3.76.'],
    [2,'Great Value Vanilla Pudding Cups, 4 pk',2.90,'?','great value vanilla pudding cups','jell o mix chocolate banana instant','swap',
     'Jell-O Zero Sugar is $5.34 for the two. Great Value is about $2.90. Saves $2.44.'],
    [1,'Great Value Mild Salsa',2.59,'?','great value salsa','pace tostitos verde queso ranch','swap',
     'Pace Chunky is $3.76. Great Value is about $2.59. Saves $1.17.'],
    [1,'Fresh Green Seedless Grapes, 2 lb &mdash; conventional',3.54,'','green seedless grapes 2 lb','organic tomato juice jelly','swap',
     'You have the organic bag at $4.97. Conventional is $3.54. Saves $1.43.'],
    [4,'GV Golden Sweet canned corn, 15.25 oz',0,'','','','remove',
     'Canned vegetables are off the plan, and you already have four bags of the frozen kernel corn. Straight removal, &minus;$3.28.'],
    [1,'Marketside Organic Bananas, Bunch',0,'','','','remove',
     'You already have six loose bananas. This is a second lot that will go brown. &minus;$1.74.'],
  ];

  const PERIOD = {
    '80% Lean / 20% Fat Ground Beef Chuck, 3 lb Roll': 4 / 3,
    'Chuck Roast, Choice Angus Beef, 1.6 - 2.85 lb': 2,
    'Great Value Beef Broth, 32 oz Carton': 2,
    'Great Value Onion Recipe Soup & Dip Mix, 2 oz': 2,
    'Top Sirloin Beef Steak, Family Pack': 2,
    'Great Value Cream Of Chicken Condensed Soup, 10.5 oz': 2,
    'Fresh Yellow Onions, 3 lb Bag': 2,
    'Great Value Diced Tomatoes in Tomato Juice, 14.5 oz Can': 2,
    'Great Value Low-Moisture Part-Skim Mozzarella Shredded Cheese, 8 oz Bag': 2,
    'Great Value Ziti, 16 oz': 2,
    'Great Value Traditional Pasta Sauce, 24 oz': 2,
    'Great Value Black Beans, 4 lb': 4 / 1.25,
    'Great Value Sliced Strawberries, 64 oz': 5.33,
    'Great Value Creamy Peanut Butter, 40 oz': 2,
    'Great Value 100% Whole Grain Old Fashioned Oats, 42 oz': 2,
    'Great Value Long Grain Enriched Rice, 20 lb': 8,
    'Great Value Singles American Cheese, 12 oz, 16 Slices': 4,
    'Great Value Mayonnaise, 30 fl oz': 3,
    'Great Value Vegetable Oil, 48 fl oz Bottle': 4,
    'Great Value Honey, 12 oz Plastic Bear': 6,
    'Heavy duty aluminum foil, 50 sq ft': 5,
    'Gallon freezer bags, 30+ ct': 10,
    'Quart freezer bags, 30+ ct': 10,
    'Great Value Chili Powder, 3 oz': 3,
    'Great Value Ground Cumin, 2.5 oz': 8,
    'Great Value Garlic Powder, 3.4 oz': 8,
    'Great Value Ground Black Pepper, 3 oz': 12,
    'Great Value Iodized Salt, 26 oz': 24,
    'Louisiana Hot Sauce, 12 oz': 4,
  };
  const QTY_BY_BLOCK = {
  };
  const OFFSET = {
    'Chuck Roast, Choice Angus Beef, 1.6 - 2.85 lb': 0,
    'Great Value Beef Broth, 32 oz Carton': 0,
    'Great Value Onion Recipe Soup & Dip Mix, 2 oz': 0,
    'Top Sirloin Beef Steak, Family Pack': 1,
    'Great Value Low-Moisture Part-Skim Mozzarella Shredded Cheese, 8 oz Bag': 1,
    'Great Value Ziti, 16 oz': 1,
    'Great Value Traditional Pasta Sauce, 24 oz': 1,
    'Heavy duty aluminum foil, 50 sq ft': 4,
    'Gallon freezer bags, 30+ ct': 9,
    'Quart freezer bags, 30+ ct': 9,
    'Great Value Chili Powder, 3 oz': 2,
    'Great Value Ground Cumin, 2.5 oz': 7,
    'Great Value Garlic Powder, 3.4 oz': 7,
    'Great Value Ground Black Pepper, 3 oz': 11,
    'Great Value Iodized Salt, 26 oz': 23,
    'Louisiana Hot Sauce, 12 oz': 3,
  };
  function buysAt(period, block, offset) {
    if (offset) {
      if (Number.isInteger(period)) return (block - 1 - offset) % period === 0;
    } else if (Number.isInteger(period)) {
      return (block - 1) % period === 0;
    }
    let cover = 0, buy = false;
    for (let b = 1; b <= block; b++) {
      buy = false;
      if (cover < 1 - 1e-9) { buy = true; cover += period; }
      cover -= 1;
    }
    return buy;
  }
  function nextDue(title, after) {
    const p = PERIOD[title] || 1;
    for (let b = after; b <= after + 30; b++) if (buysAt(p, b, OFFSET[title] || 0)) return b;
    return null;
  }
  function listForBlock(block) {
    if (block === 0) return SETUP;   // the one-time shop, bought once, never again
    return LIST.filter(r => buysAt(PERIOD[r[1]] || 1, block, OFFSET[r[1]] || 0))
               .map(r => { const q = QTY_BY_BLOCK[r[1]]; return q ? [q(block), ...r.slice(1)] : r; });
  }

  const UNITS_ALL = LIST.reduce((a, r) => a + r[0], 0);
  const unitsBefore = n => WALK().slice(0, n).reduce((a, r) => a + r[0], 0);

  const VERSION = '1.43.0';
  const VER = '1.11';
  const KEY = 'mealplan_idx', LKEY = 'mealplan_log';
  if (GM_getValue('mealplan_ver', '') !== VER) {
    GM_setValue('mealplan_ver', VER);
    GM_setValue(KEY, 0);
  }
  const CKEY = 'mealplan_min';
  let minimised = GM_getValue(CKEY, '') === '1';
  const AKEY = 'mealplan_all';
  let showAll = GM_getValue(AKEY, '') === '1';
  const MKEY = 'mealplan_mode', BKEY = 'mealplan_block';
  let fixMode = GM_getValue(MKEY, '') === 'fix';
  let attnMode = GM_getValue(MKEY, '') === 'attn';
  const ATKEY = 'mealplan_attn';
  let block = Math.max(0, Number(GM_getValue(BKEY, 1)) || 0);
  const FULL = () => (block === 0 ? SETUP : LIST);
  const ALL_ROWS = () => SETUP.concat(LIST);
  const blockName = b => (b === 0 ? 'Setup' : 'Block ' + b);
  let BLOCKLIST = listForBlock(block);
  let ATTN = (() => { try { const a = JSON.parse(GM_getValue(ATKEY, '{}')); return a.blk === block ? a.names || [] : []; }
                      catch (e) { return []; } })();
  const WALK = () => (fixMode ? FIXES : attnMode ? BLOCKLIST.filter(r => ATTN.includes(r[1])) : BLOCKLIST);
  if (attnMode && !onCart && WALK().length === 0) { attnMode = false; GM_setValue(MKEY, 'list'); }
  const UNITS = () => WALK().reduce((a, r) => a + r[0], 0);
  function setBlock(n) {
    block = Math.max(0, n);
    GM_setValue(BKEY, block);
    BLOCKLIST = listForBlock(block);
    if (attnMode) { attnMode = false; GM_setValue(MKEY, 'list'); }
    GM_setValue(KEY, 0); i = 0;
    go(0);
  }
  let i = Number(GM_getValue(KEY, 0));
  if (!(i >= 0 && i < WALK().length)) i = 0;
  function setMode(m) {
    fixMode = (m === 'fix');
    attnMode = (m === 'attn');
    GM_setValue(MKEY, fixMode ? 'fix' : attnMode ? 'attn' : 'list');
    GM_setValue(KEY, 0);
    i = 0;
    go(0);
  }

  const OKEY = 'mealplan_over';
  let OVER = {};
  try { OVER = JSON.parse(GM_getValue(OKEY, '{}')) || {}; } catch (e) { OVER = {}; }
  const saveOver = () => GM_setValue(OKEY, JSON.stringify(OVER));
  function accept(title, subName, price) {
    OVER[title] = {sub: subName, price: price == null ? null : price,
                   blk: block, ts: Date.now()};
    saveOver();
  }
  function overStale(o) { return o && o.sub != null && o.blk != null && o.blk !== block; }
  function skipBlock(title, blk) { OVER[title] = {skipBlk: blk, ts: Date.now()}; saveOver(); }
  function clearOver(title) { delete OVER[title]; saveOver(); }
  function overrideHit(text, acc) {
    const w = norm(acc).split(' ').filter(x => x.length > 2 || /[0-9]/.test(x));
    return w.length ? w.filter(x => text.includes(x)).length / w.length : 0;
  }

  const PARSER = 2;   // bump whenever tilePrice/money changes meaning
  let LOG = {};
  try { LOG = JSON.parse(GM_getValue(LKEY, '{}')) || {}; } catch (e) { LOG = {}; }
  let stale = 0;
  for (const k of Object.keys(LOG)) {
    if ((LOG[k].pv || 1) < PARSER && LOG[k].got != null) { LOG[k].got = null; LOG[k].old = true; stale++; }
  }
  if (stale) GM_setValue(LKEY, JSON.stringify(LOG));
  const saveLog = () => GM_setValue(LKEY, JSON.stringify(LOG));

  const BOILER = /(snap ebt eligible|free \d+ day returns|gift eligible[a-z ]*|gifteligibleicon|multipack quantity\s*:?\s*\d+|best seller|sponsored|[0-9]+k?\+? bought since yesterday|rollback|you save|save with|walmart plus|final cost by weight|current price|out of \d+ stars|[0-9.]+ ?(?:c|\u00a2)\s*\/\s*[a-z ]+|delivery as soon as[a-z0-9 ]*|pickup as soon as[a-z0-9 ]*|shipping arrives[a-z ]*)/g;
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(BOILER, ' ').replace(/\s+/g, ' ').trim();
  const esc  = s => (s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  let LIVE = null, SOFT = false, HITNAME = '';

  function money(s) {
    const m = String(s || '').match(/\$\s*([0-9]+)(?:\.([0-9]{2})(?![0-9])|\s*[\n\r]+\s*([0-9]{2})(?![0-9]))/);
    return m ? parseFloat(m[1] + '.' + (m[2] || m[3])) : null;
  }
  function tilePrice(t) {
    if (!t) return null;
    for (const a of t.querySelectorAll('[aria-label*="price" i]')) {
      const lbl = a.getAttribute('aria-label') || '';
      if (!/current price/i.test(lbl) && /\bwas\b|\bper\b|\/\s*(oz|lb|ct|ea|fl)/i.test(lbl)) continue;
      const v = money(lbl);
      if (v !== null) return v;
    }
    const stripped = (t.innerText || '')
      .replace(/\$\s?[0-9.]+\s*\/\s*(oz|lb|ct|ea|fl|gal|qt)/gi, ' ')
      .replace(/[0-9.]+\s*(c|¢)\s*\/\s*[a-z]+/gi, ' ')
      .replace(/\bwas\s*\$\s*[0-9.]+/gi, ' ');
    return money(stripped);
  }
  function tileName(t) {
    if (!t) return '';
    const n = t.querySelector('[data-automation-id="product-title"], [data-testid="product-title"], span[class*="lh-title"]');
    const s = (n ? n.innerText : (t.innerText || '').split('\n').find(l => l.trim().length > 12) || '');
    return s.trim().slice(0, 110);
  }

  const STOP = new Set(['great','value','fresh','whole','guaranteed','marketside','bag','count','pack','size']);

  function score(text, idx, enforceSize, dropNums, noReject, arr) {
    arr = arr || LIST;
    const bad = noReject ? [] : (arr[idx][5] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (bad.some(b => new RegExp('(^| )' + b + '( |$)').test(text))) return -1;
    const want = norm(arr[idx][1]);
    let words = want.split(' ').filter(w => w.length > 2 || /[0-9]/.test(w));
    if (dropNums) words = words.filter(w => !/^[0-9.]+$/.test(w));
    const sizes = enforceSize ? (want.match(/[0-9]+(?:\.[0-9]+)?/g) || []) : [];
    if (sizes.length && !sizes.every(n => new RegExp('(^|[^0-9])' + n + '([^0-9]|$)').test(text))) return -1;
    if (!words.length) return 0;
    const key = words.filter(w => !STOP.has(w));
    const hit = w => text.includes(w) || (w.length > 4 && w.endsWith('s') && text.includes(w.slice(0, -1)));
    if (noReject) return key.length ? key.filter(hit).length / key.length : 0;
    if (key.length && key.filter(hit).length / key.length < 0.6) return -1;
    return words.filter(hit).length / words.length;
  }
  function scanTiles(enforceSize, dropNums) {
    let best = null, bestScore = 0;
    for (const t of document.querySelectorAll('[data-item-id]')) {
      const s = score(norm(t.innerText), i, enforceSize, dropNums, false, WALK());
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return [best, bestScore];
  }

  function highlight(allowLoose) {
    SOFT = false; LIVE = null; HITNAME = '';
    const ovr = OVER[WALK()[i][1]];
    if (ovr && ovr.sub && !overStale(ovr)) {
      let best = null, bs = 0;
      for (const t of document.querySelectorAll('[data-item-id]')) {
        const v = overrideHit(norm(t.innerText), ovr.sub);
        if (v > bs) { bs = v; best = t; }
      }
      document.querySelectorAll('.mp-hit, .mp-soft').forEach(e => e.classList.remove('mp-hit', 'mp-soft'));
      if (best && bs > 0.6) {
        best.classList.add('mp-hit'); best.scrollIntoView({behavior: 'smooth', block: 'center'});
        LIVE = tilePrice(best); HITNAME = tileName(best);
        return Math.round(bs * 100);
      }
      return 0;
    }
    const noGate = WALK()[i][3] === '?' || WALK()[i][3] === 'w';
    let [best, bestScore] = scanTiles(!noGate, noGate);
    if ((!best || bestScore <= 0.55) && allowLoose && !noGate) {
      const [b2, s2] = scanTiles(false, true);
      if (b2 && s2 > 0.55) { best = b2; bestScore = s2; SOFT = true; }
    }
    document.querySelectorAll('.mp-hit, .mp-soft').forEach(e => e.classList.remove('mp-hit', 'mp-soft'));
    if (best && bestScore > 0.55) {
      best.classList.add(SOFT ? 'mp-soft' : 'mp-hit');
      best.scrollIntoView({behavior: 'smooth', block: 'center'});
      LIVE = tilePrice(best);
      HITNAME = tileName(best);
      return Math.round(bestScore * 100);
    }
    return 0;
  }

  function go(n) {
    const L = WALK();
    if (attnMode && n >= L.length) { location.href = 'https://www.walmart.com/cart'; return; }
    i = Math.max(0, Math.min(L.length - 1, n));
    GM_setValue(KEY, i);
    if (L[i][6] === 'remove') { location.href = 'https://www.walmart.com/cart'; return; }
    location.href = 'https://www.walmart.com/search?q=' + encodeURIComponent(L[i][4]);
  }

  function logAdded() {
    if (fixMode) return;   // the fix list is corrections, not the block's buy log
    const r = WALK()[i];
    LOG[r[1]] = {n: r[1], q: r[0], exp: r[2], got: LIVE, saw: HITNAME, blk: block, pv: PARSER, ts: Date.now()};
    saveLog();
  }

  function report() {
    const W = fixMode ? FULL() : WALK();
    const L = ['Walmart meal-plan shop - ' + new Date().toLocaleString() + '  [pilot v' + VERSION + ']',
               blockName(block).toUpperCase() + ' - ' + W.length + ' lines, ' + W.reduce((a, r) => a + r[0], 0) + ' units', ''];
    let known = 0, seen = 0;
    W.forEach((r) => {
      const e = LOG[r[1]];
      const mark = e ? '[x]' : '[ ]';
      let line = mark + ' ' + r[0] + 'x ' + r[1] + '  exp $' + r[2].toFixed(2);
      if (e && e.got != null) { line += '  GOT $' + e.got.toFixed(2); known += e.got * r[0]; seen++; }
      else if (e && e.old) line += '  GOT ?  <- captured by an older parser, price discarded, re-walk to measure';
      else if (e) line += '  GOT ?  <- price not readable; do NOT infer one';
      if (e && e.saw) line += '\n      tile: ' + e.saw;
      L.push(line);
    });
    L.push('', 'priced from tiles: ' + seen + ' of ' + W.length + ' lines = $' + known.toFixed(2));
    L.push('(by-weight lines - chicken, chuck roast, sirloin - only settle on the receipt)');
    return L.join('\n');
  }

  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;top:-2000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (e) { btn.textContent = 'copy failed'; }
    }
  }

  const css = document.createElement('style');
  css.textContent = `
    .mp-hit{outline:3px solid #2f6b3f !important;outline-offset:3px;border-radius:6px;
      box-shadow:0 0 0 9999px rgba(0,0,0,.04)}
    .mp-soft{outline:3px dashed #b0791c !important;outline-offset:3px;border-radius:6px}
    .mp-extra{outline:3px solid #b0421c !important;outline-offset:3px;border-radius:6px;background:rgba(176,66,28,.05)}
    .mp-notdue{outline:3px solid #b0421c !important;outline-offset:3px;border-radius:6px;background:rgba(176,66,28,.05)}
    .mp-swap{outline:3px solid #b0791c !important;outline-offset:3px;border-radius:6px;background:rgba(176,121,28,.05)}
    #mp-panel{position:fixed;right:16px;bottom:16px;z-index:999999;background:#fff;
      border:1px solid #cfd6ca;border-left:5px solid #2f6b3f;border-radius:8px;
      box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.45 system-ui;--line:#e6eae4;
      width:${onCart ? 360 : 290}px;max-width:calc(100vw - 32px);padding:12px 14px;
      /* it grows UPWARDS from the bottom, so without this the title bar and its
         minimise button climb straight off the top of the window. */
      max-height:calc(100vh - 32px);display:flex;flex-direction:column}
    #mp-body{overflow-y:auto;overscroll-behavior:contain;flex:1 1 auto;min-height:0;
      margin-right:-4px;padding-right:4px}
    #mp-panel b{display:block;font-size:15px;margin:2px 0 4px}
    #mp-panel .r{display:flex;gap:8px;margin-top:9px}
    #mp-panel button{flex:1;padding:7px 0;border:1px solid #cfd6ca;border-radius:5px;
      background:#f5f7f2;cursor:pointer;font:600 13px system-ui}
    #mp-panel button.pri{background:#2f6b3f;color:#fff;border-color:#2f6b3f}
    #mp-panel .m{font-size:12px;color:#6d766c}
    #mp-bar{display:flex;align-items:center;gap:8px;margin:-4px -4px 4px 0}
    #mp-bar .mp-sum{flex:1;font:600 12.5px system-ui;color:#2f6b3f;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis}
    #mp-bar button{flex:0 0 26px;width:26px;padding:2px 0;font-size:15px;line-height:1}
    #mp-panel.mp-min{width:auto;max-width:270px;padding:7px 10px;max-height:none}
    #mp-panel.mp-min > *:not(#mp-bar){display:none}
    #mp-panel.mp-min #mp-bar{margin:0}
    .mp-rows{margin-top:8px;border-top:1px solid #e6eae4;font-size:12.5px;line-height:1.5}
    .mp-rows div{padding:3px 0;border-bottom:1px solid #f1f4ef;display:flex;gap:7px}
    .mp-rows i{font-style:normal;width:13px;flex:none;font-weight:700}
    .mp-acts{display:flex;gap:6px;margin-top:4px}
    #mp-panel .mp-acts button{flex:0 1 auto;padding:3px 8px;font-size:11.5px;font-weight:600}
    /* 290px is enough for one item; it is not enough for 31 rows of
       "2x Great Value Thick and Chunky Salsa Mild, 16 oz  $2.48". */
    #mp-panel.mp-wide:not(.mp-min){width:360px}
    .mp-jump div{cursor:pointer}
    .mp-jump div:hover{background:#f5f7f2}
    .mp-jump .n{flex:1;min-width:0}
    .mp-jump .p{flex:none;color:#6d766c;font-size:11.5px}
    .mp-jump .cur{background:#eef3ea}
    .mp-ok{color:#2f6b3f}.mp-no{color:#b0421c}.mp-mid{color:#b0791c}`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.id = 'mp-panel';
  document.body.appendChild(el);

  function bar(summary) {
    return `<div id="mp-bar"><span class="mp-sum">${summary}</span>
      <button id="mp-min" title="${minimised ? 'Expand' : 'Minimise'}">${minimised ? '&plus;' : '&minus;'}</button></div>`;
  }
  function wireBar(redraw) {
    try {
      const barEl = el.querySelector('#mp-bar');
      if (barEl && !el.querySelector('#mp-body') && el.childNodes && el.childNodes.length) {
        const body = document.createElement('div');
        body.id = 'mp-body';
        Array.prototype.slice.call(el.childNodes)
          .filter(n => n !== barEl)
          .forEach(n => body.appendChild(n));
        el.appendChild(body);
      }
    } catch (e) { /* a panel that does not scroll beats no panel */ }
    const b = el.querySelector('#mp-min');
    if (b) b.onclick = () => { minimised = !minimised; GM_setValue(CKEY, minimised ? '1' : '0'); redraw(); };
    if (el.classList) el.classList.toggle('mp-min', minimised);
  }

  const CART_SEL = [
    ['[data-item-id]',                                             'item tiles'],
    ['[data-us-item-id]',                                          'us-item-id rows'],
    ['[data-testid*="cart-item"],[data-testid*="item-row"],[data-testid*="cartItem"]', 'cart-item testids'],
    ['[data-automation-id*="cart-item"],[data-automation-id*="item"]', 'automation-id rows'],
    ['li[data-testid],ul[data-testid] > li',                        'list items'],
    ['[data-testid],[data-automation-id]',                          'any tagged node'],
  ];
  const QTY_CTL = [
    'select[aria-label*="uantity" i]', 'select[name*="uantity" i]', 'select',
    'input[type="number"]', 'input[aria-label*="uantity" i]',
    '[data-testid*="quantity" i]', '[data-automation-id*="quantity" i]',
    '[aria-label*="quantity of" i]',
    'button[aria-label^="Increase" i]', 'button[aria-label^="Decrease" i]',
  ].join(',');
  function isLine(n) {
    const t = n.innerText || '';
    if (t.length < 20 || t.length > 900 || !/\$\s?[0-9]/.test(t)) return false;
    return !!n.querySelector(QTY_CTL);
  }
  function lineFor(n) {
    let c = n;
    for (let k = 0; k < 6 && c; k++, c = c.parentElement) if (isLine(c)) return c;
    return null;
  }
  function cartRows() {
    let best = null, bestHow = '', bestN = 0;
    for (const [sel, how] of CART_SEL) {
      let nodes;
      try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { continue; }
      let cand = [];
      for (const n of nodes) { const l = lineFor(n); if (l && cand.indexOf(l) < 0) cand.push(l); }
      cand = cand.filter(n => !cand.some(o => o !== n && n.contains && n.contains(o)));
      if (cand.length > bestN) { bestN = cand.length; best = cand; bestHow = how; }
    }
    if (bestN >= 3) return [best.map(n => ({node: n, txt: norm(n.innerText), qty: rowQty(n),
                                            name: (n.innerText || '').split('\n')[0].trim().slice(0, 58)})),
                            bestHow + ' (' + bestN + ' rows)'];
    const main = document.querySelector('main') || document.body;
    return [[{txt: norm(main.innerText), qty: 0}], 'page text (qty unknown)'];
  }

  function cartDiag() {
    const main = document.querySelector('main') || document.body;
    const txt = main.innerText || '';
    const out = ['--- cart diagnostics (pilot v' + VERSION + ') ---',
      'url: ' + location.pathname + '  readyState: ' + document.readyState,
      'main text: ' + txt.length + ' chars  subtotal:' + /subtotal/i.test(txt) +
        '  "great value":' + /great value/i.test(txt)];
    for (const [sel] of CART_SEL) {
      let ns = []; try { ns = [...document.querySelectorAll(sel)]; } catch (e) {}
      let len = 0, price = 0, qty = 0, climbed = 0;
      for (const n of ns.slice(0, 120)) {
        const t = n.innerText || '';
        if (t.length >= 20 && t.length <= 900) len++;
        if (/\$\s?[0-9]/.test(t)) price++;
        if (n.querySelector && n.querySelector(QTY_CTL)) qty++;
        if (lineFor(n)) climbed++;
      }
      out.push('  ' + ns.length + ' nodes  ' + sel.slice(0, 46) +
               '  [len ok:' + len + ' price:' + price + ' qtyctl:' + qty + ' ->row:' + climbed + ']');
    }
    if (!document.querySelector(QTY_CTL)) {
      out.push('NOTHING on this page matches QTY_CTL. aria-labels present:');
      const al = {};
      for (const n of document.querySelectorAll('[aria-label]')) {
        const v = (n.getAttribute('aria-label') || '').slice(0, 40);
        if (v) al[n.tagName + ' ' + v] = (al[n.tagName + ' ' + v] || 0) + 1;
      }
      Object.entries(al).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => out.push('  x' + v + '  ' + k));
    }
    const seen = {};
    for (const n of document.querySelectorAll('[data-testid],[data-automation-id],[data-item-id],[data-us-item-id]')) {
      const t = n.innerText || '';
      if (t.length > 25 && t.length < 500 && /\$[0-9]/.test(t) && /(remove|qty|quantity|increase)/i.test(t)) {
        for (const a of n.attributes) {
          if (a.name.startsWith('data-')) {
            const k = a.name + '=' + String(a.value).slice(0, 45);
            seen[k] = (seen[k] || 0) + 1;
          }
        }
      }
    }
    const top = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 20);
    out.push('cart-line-shaped nodes carry:');
    top.forEach(([k, v]) => out.push('  x' + v + '  ' + k));
    if (!top.length) out.push('  (none found - page may not have rendered)');
    const [rows, how] = cartRows();
    out.push('cartRows() -> ' + how);
    rows.slice(0, 3).forEach((r, k) => out.push('  row' + k + ' qty=' + r.qty + ': ' + r.txt.slice(0, 110)));
    let shown = 0;
    for (const [sel] of CART_SEL) {
      let ns = []; try { ns = [...document.querySelectorAll(sel)]; } catch (e) {}
      const seenN = [];
      for (const n of ns) {
        const l = lineFor(n);
        if (l && seenN.indexOf(l) < 0 && shown < 2) { seenN.push(l); shown++; out.push('RAW row' + shown + ': ' + JSON.stringify((l.innerText || '').slice(0, 300))); }
      }
      if (shown >= 2) break;
    }
    out.push('first 500 chars of main: ' + txt.slice(0, 500).replace(/\s*\n+\s*/g, ' | '));
    return out.join('\n');
  }
  function rowQty(n) {
    const num = v => (v != null && /^[0-9]+$/.test(String(v).trim()) ? +v : null);
    const sel = n.querySelector('select');
    if (sel && num(sel.value)) return num(sel.value);
    const inp = n.querySelector('input[type="number"],input[aria-label*="quantity" i]');
    if (inp && num(inp.value)) return num(inp.value);
    const raw = (n.innerText || '').replace(/multipack quantity\s*:?\s*[0-9]+/ig, ' ');
    let m = raw.match(/\bqty\s*:?\s*([0-9]+)/i) || raw.match(/\bquantity\s*:?\s*([0-9]+)/i);
    if (m) return +m[1];
    const ls = raw.split('\n').map(x => x.trim()).filter(Boolean);
    for (let k = ls.length - 1; k >= 0; k--) if (/^[0-9]{1,2}$/.test(ls[k])) return +ls[k];
    for (const a of n.querySelectorAll('[aria-label*="uantity" i]')) {
      const q = (a.getAttribute('aria-label') || '').match(/([0-9]+)\s*$/);
      if (q) return +q[1];
    }
    for (const a of n.querySelectorAll('[data-testid*="quantity" i],[data-automation-id*="quantity" i],span,div')) {
      const t = (a.textContent || '').trim();
      if (/^[0-9]{1,2}$/.test(t) && !a.querySelector('*')) return +t;
    }
    return null;   // unknown, NOT one
  }

  function renderCart() {
    const [rows, how] = cartRows();
    const textOnly = how.startsWith('page text');
    let linesIn = 0, unitsIn = 0, subs = 0, rowsHtml = '';
    const claimed = new Set(), wrong = [], problems = [];
    let missingCount = 0;
    const attn = [];   // every line with a Find it button, in list order
    const skipped = (fixMode ? FULL() : BLOCKLIST).filter(r => OVER[r[1]] && OVER[r[1]].skipBlk === block);
    const AUD = (fixMode ? FULL() : BLOCKLIST).filter(r => !(OVER[r[1]] && OVER[r[1]].skipBlk === block));
    AUD.forEach((r, n) => {
      const [wantQ, name] = r;
      const noGate = AUD[n][3] === '?' || AUD[n][3] === 'w';
      let bestS = 0, bestQ = 0, bestI = -1;
      rows.forEach((row, k) => {
        const s = score(row.txt, n, !noGate && !textOnly, noGate, textOnly, AUD);
        if (s > bestS) { bestS = s; bestQ = row.qty; bestI = k; }
      });
      let found = bestS > 0.6, accepted = '';
      const ov = OVER[r[1]];
      if (!found && !textOnly && ov && ov.sub && !overStale(ov)) {
        let os = 0, oi = -1;
        rows.forEach((row, k) => { const v = overrideHit(row.txt, ov.sub); if (v > os) { os = v; oi = k; } });
        if (os > 0.6) { found = true; accepted = ov.sub; bestQ = rows[oi].qty; bestI = oi; }
      }
      let sub = '', subI = -1;
      if (!found && !textOnly) {
        let ss = 0;
        rows.forEach((row, k) => {
          const v = score(row.txt, n, false, true, true, AUD);
          if (v > ss) { ss = v; sub = row.name || ''; subI = k; }
        });
        if (ss <= 0.6) { sub = ''; subI = -1; } else { subs++; claimed.add(subI); wrong.push([subI, 'swap for ' + esc(r[1])]); }
      }
      if (found) claimed.add(bestI);
      if (found && !textOnly) { linesIn++; unitsIn += bestQ || wantQ; }
      const short = found && !textOnly && bestQ != null && bestQ < wantQ;
      const qUnknown = found && !textOnly && bestQ == null && wantQ > 1;
      const cls  = textOnly ? 'mp-mid' : !found ? (sub ? 'mp-mid' : 'mp-no') : (short || qUnknown) ? 'mp-mid' : 'mp-ok';
      const mark = textOnly ? '?' : !found ? (sub ? '&ne;' : '&times;') : '&#10003;';
      const note = textOnly ? ' <span class="m">' + (found ? 'word seen on the page' : 'not seen') + ', unverified</span>'
                 : !found ? (sub
                     ? ' <span class="m">cart has <b style="display:inline">' + esc(sub) + '</b> instead</span>'
                       + (overStale(ov) ? ' <span class="m mp-mid">&mdash; you subbed this LAST shop; is the shelf still out?</span>' : '')
                     : ' <span class="m">nothing like it in the cart</span>')
                 : short ? ' <span class="m">qty ' + bestQ + ', need ' + wantQ + '</span>'
                 : qUnknown ? ' <span class="m">need &times;' + wantQ + ', qty not readable</span>'
                 : accepted ? ' <span class="m mp-mid">override &mdash; ' + esc(accepted) + '</span>'
                 : (wantQ > 1 ? ' <span class="m">&times;' + wantQ + ' ok</span>' : '');
      rowsHtml += '<div><i class="' + cls + '">' + mark + '</i><span>' + esc(name) + note + '</span></div>';
      if (!textOnly) {
        const acts = (subName) => '<div class="mp-acts">' +
            '<button class="mp-act pri" data-act="goto" data-line="' + esc(name) + '">Find it &rarr;</button>' +
            (subName ? '<button class="mp-act" data-act="accept" data-line="' + esc(name) +
               '" data-sub="' + esc(subName) + '">Accept this instead</button>' : '') +
            '<button class="mp-act" data-act="skip" data-line="' + esc(name) + '">Skip this block</button></div>';
        if ((!found) || short) attn.push(r[1]);
        if (!found && sub) problems.push('<b class="mp-mid" style="display:inline">&ne; SWAP</b> ' + esc(name) +
          ' &mdash; cart has <b style="display:inline">' + esc(sub) + '</b>' + acts(sub));
        else if (!found) { missingCount++; problems.push('<b class="mp-no" style="display:inline">&times; MISSING</b> ' + esc(name) +
          (wantQ > 1 ? ' &times;' + wantQ : '') + acts('')); }
        else if (short) problems.push('<b class="mp-mid" style="display:inline">! SHORT</b> ' + esc(name) +
          ' &mdash; cart has ' + bestQ + ', need ' + wantQ +
          '<div class="mp-acts"><button class="mp-act pri" data-act="goto" data-line="' + esc(name) +
          '">Find it &rarr;</button></div>');
        else if (qUnknown) problems.push('<b class="mp-mid" style="display:inline">? QTY</b> ' + esc(name) +
          ' &mdash; need &times;' + wantQ + ', could not read the quantity');
      }
    });
    if (!textOnly) { ATTN = attn; GM_setValue(ATKEY, JSON.stringify({blk: block, names: attn})); }
    const extras = textOnly ? [] : rows.map((r, k) => [k, r]).filter(([k]) => !claimed.has(k));
    const notDue = [], setupHave = [], strays = [];
    extras.forEach(([, r]) => {
      let bi = -1, bs = 0;
      ALL_ROWS().forEach((lr, n) => {
        const ng = lr[3] === '?' || lr[3] === 'w';
        const v = score(r.txt, n, !ng, ng, false, ALL_ROWS());
        if (v > bs) { bs = v; bi = n; }
      });
      if (bs <= 0.6) strays.push(r);
      else if (SETUP.indexOf(ALL_ROWS()[bi]) >= 0) setupHave.push([r, ALL_ROWS()[bi]]);
      else notDue.push([r, ALL_ROWS()[bi]]);
    });
    if (!textOnly) notDue.forEach(([r, lr]) => problems.push('<b class="mp-no" style="display:inline">&times; NOT DUE</b> ' +
      esc(r.name) + ' &mdash; on the plan, but not this shop (next due block ' + (nextDue(lr[1], block + 1) || '?') +
      '). <b style="display:inline">Take it out of the cart</b> &mdash; outlined red.'));
    document.querySelectorAll('.mp-extra, .mp-swap, .mp-notdue').forEach(e => e.classList.remove('mp-extra', 'mp-swap', 'mp-notdue'));
    if (!textOnly) {
      strays.forEach(r => { if (r.node && r.node.classList) r.node.classList.add('mp-extra'); });
      notDue.forEach(([r]) => { if (r.node && r.node.classList) r.node.classList.add('mp-notdue'); });
      wrong.forEach(([k]) => { const r = rows[k]; if (r && r.node && r.node.classList) r.node.classList.add('mp-swap'); });
    }
    const extraHtml = (strays.length ?
        '<div class="m" style="margin-top:9px;padding-top:7px;border-top:1px solid var(--line)">' +
        '<b class="mp-no" style="display:inline">' + strays.length + ' on no line of the plan</b> &mdash; outlined red on the page</div>' +
        '<div class="mp-rows">' +
        strays.map(r => '<div><i class="mp-no">&times;</i><span>' + esc(r.name) +
          (r.qty ? ' <span class="m">&times;' + r.qty + '</span>' : '') + '</span></div>').join('') + '</div>'
      : '') + (setupHave.length ?
        '<div class="m" style="margin-top:9px;padding-top:7px;border-top:1px solid var(--line)">' +
        '<b class="mp-ok" style="display:inline">' + setupHave.length + ' setup item' + (setupHave.length > 1 ? 's' : '') + '</b> &mdash; bought once, fine in this cart</div>' +
        '<div class="mp-rows">' +
        setupHave.map(([r]) => '<div><i class="mp-ok">&#10003;</i><span>' + esc(r.name) + '</span></div>').join('') + '</div>'
      : '');
    const overKeys = Object.keys(OVER);
    const overHtml = overKeys.length
      ? '<div class="m" style="margin-top:9px;padding-top:7px;border-top:1px solid var(--line)">' +
        '<b class="mp-mid" style="display:inline">' + overKeys.length + ' override' +
        (overKeys.length > 1 ? 's' : '') + '</b> &mdash; these lines are not being checked as written</div>' +
        '<div class="mp-rows">' + overKeys.map(k => {
          const o = OVER[k];
          const what = o.skipBlk != null ? 'skipped on ' + blockName(o.skipBlk).toLowerCase()
                     : 'accepting <b style="display:inline">' + esc(o.sub) + '</b>';
          return '<div><i class="mp-mid">&#9679;</i><span>' + esc(k) + ' <span class="m">' + what + '</span>' +
                 '<div class="mp-acts"><button class="mp-act" data-act="clear" data-line="' + esc(k) +
                 '">Undo</button></div></span></div>';
        }).join('') + '</div>'
      : '';
    const allIn = linesIn === AUD.length;
    el.innerHTML = bar(textOnly ? 'Cart audit &mdash; cannot verify'
        : `${blockName(block)} &middot; ${linesIn}/${AUD.length} lines &middot; ${unitsIn}/${AUD.reduce((a, r) => a + r[0], 0)} units`) + `
      <div class="m">Cart audit &middot; ${blockName(block).toLowerCase()}${block === 0 ? ' &mdash; one-time, bought once' : block > 1 ? ' restock' : ' &mdash; first shop, everything due'} &middot; read from ${how}${textOnly ? ' &middot; <span class="mp-no">still looking&hellip;</span>' : ''}</div>
      ${textOnly
        ? `<b class="mp-no">Cannot verify this cart</b>
           <div class="m">No cart rows found in the page, only a text blob &mdash; so nothing above is
           confirmed. <b style="display:inline">Copy report and send it</b>; the diagnostics say why.</div>`
        : `<b class="${problems.length ? 'mp-mid' : 'mp-ok'}">${
             problems.length === 0 ? '&#10003; Nothing missing, nothing short'
             : missingCount === 0 ? 'Nothing is MISSING &mdash; ' + problems.length + ' line' + (problems.length > 1 ? 's need' : ' needs') + ' attention'
             : missingCount + ' line' + (missingCount > 1 ? 's' : '') + ' not in the cart at all'}</b>
           <div class="m">${linesIn} of ${AUD.length} lines &middot; ${unitsIn} of ${AUD.reduce((a, r) => a + r[0], 0)} units
           &middot; Walmart's own count should read <b style="display:inline">${AUD.reduce((a, r) => a + r[0], 0)}</b>.${
             skipped.length ? ' <b class="mp-mid" style="display:inline">' + skipped.length + ' skipped this block</b>: ' +
               skipped.map(r => esc(r[1])).join(', ') + '.' : ''}</div>`}
      ${problems.length ? `<div class="m" style="margin-top:8px;padding:7px 9px;border:1px solid var(--line);
             border-left:3px solid #b0421c;border-radius:4px;background:rgba(176,66,28,.05)">
          <b class="mp-no" style="display:inline">Needs attention &mdash; ${problems.length}</b>${attn.length > 1
            ? '<div class="mp-acts"><button class="mp-act pri" data-act="goto" data-line="' + esc(attn[0]) +
              '">Find all ' + attn.length + ', one after another &rarr;</button></div>' : ''}
          ${problems.map(x => '<div style="margin-top:3px">' + x + '</div>').join('')}</div>`
        : (textOnly ? '' : `<div class="m" style="margin-top:8px"><b class="mp-ok" style="display:inline">&#10003; every line on block ${block} is in, at the right quantity</b></div>`)}
      <details style="margin-top:8px"><summary class="m" style="cursor:pointer">All ${AUD.length} lines</summary>
      <div class="mp-rows">${rowsHtml}</div></details>
      ${overHtml}
      ${extraHtml}
      <div class="r">
        <button id="mp-re">Re-scan</button>
        <button id="mp-copy" class="pri">Copy report</button>
      </div>
      <div class="r" style="margin-top:5px">
        <button id="mp-fix">Walk the ${FIXES.length} fixes</button>
        <button id="mp-restart">Restart ${blockName(block).toLowerCase()}</button>
      </div>
      <div class="r" style="margin-top:5px">
        <button id="mp-prevblk"${block > 0 ? '' : ' disabled style="opacity:.45;cursor:default"'}>&larr; ${blockName(Math.max(0, block - 1))}</button>
        <button id="mp-nextblk" class="pri">${block === 0 ? 'The food shop &mdash; block 1' : 'Next shop &mdash; block ' + (block + 1)} &rarr;</button>
      </div>
      <div class="m" style="margin-top:5px">Block ${block + 1} needs
        <b style="display:inline">${listForBlock(block + 1).length} lines</b>, not ${LIST.length}
        &mdash; ${LIST.length - listForBlock(block + 1).length} things are still in the cupboard.</div>
      <div class="m" style="margin-top:7px">Amber outline = swap it. Red outline = remove it. Green = correct.</div>`;
    el.querySelectorAll('.mp-act').forEach(b => {
      b.onclick = () => {
        const line = b.getAttribute('data-line');
        const act = b.getAttribute('data-act');
        if (act === 'goto') {
          fixMode = false; attnMode = true;
          GM_setValue(MKEY, 'attn');
          const n = WALK().findIndex(r => r[1] === line);
          if (n >= 0) { go(n); return; }
          attnMode = false;
          GM_setValue(MKEY, 'list');
          const m = BLOCKLIST.findIndex(r => r[1] === line);
          if (m >= 0) go(m);
          return;
        }
        if (act === 'accept') accept(line, b.getAttribute('data-sub'), null);
        else if (act === 'skip') skipBlock(line, block);
        else clearOver(line);
        renderCart();
      };
    });
    el.querySelector('#mp-re').onclick = () => renderCart();
    el.querySelector('#mp-copy').onclick = e => copy(report() + '\n\nCART AUDIT block ' + block + ' (' + how + '): ' +
      linesIn + '/' + AUD.length + ' lines, ' + unitsIn + '/' + AUD.reduce((a, r) => a + r[0], 0) + ' units' +
      (notDue.length ? '\nNOT DUE THIS BLOCK, in the cart anyway: ' + notDue.map(x => x[1][1]).join('; ') : '') +
      (setupHave.length ? '\nsetup items in the cart: ' + setupHave.map(x => x[1][1]).join('; ') : '') +
      (strays.length ? '\nON NO LINE OF THE PLAN: ' + strays.map(x => x.name).join('; ') : '') +
      '\n\n' + cartDiag(), e.target);
    el.querySelector('#mp-restart').onclick = () => setMode('list');
    el.querySelector('#mp-fix').onclick = () => setMode('fix');
    el.querySelector('#mp-nextblk').onclick = () => setBlock(block + 1);
    el.querySelector('#mp-prevblk').onclick = () => setBlock(block - 1);
    wireBar(renderCart);
    return linesIn;
  }

  function verdict(qty, price, wt) {
    if (!price) return '';
    if (wt === '?') return '<b style="display:inline" class="mp-mid">size + price unverified &mdash; take the best value, it gets recorded</b>';
    if (LIVE === null) return '<span style="opacity:.6">no price read</span>';
    const unit = price / qty, d = (LIVE - unit) / unit;
    const tol = wt === 'w' ? 0.25 : 0.12;   // by-weight trays vary, don't cry wolf
    if (wt === 'w' && d < -0.10) return '<b style="display:inline" class="mp-no">&#9888; $' + LIVE.toFixed(2) + ' avg vs $' + unit.toFixed(2) +
      ' (' + Math.round(d * 100) + '%) &mdash; a LIGHTER tray than the plan. Look for a heavier listing.</b>';
    if (Math.abs(d) <= tol) return '<b style="display:inline" class="mp-ok">&#10003; $' + LIVE.toFixed(2) + ' as budgeted</b>' +
      (wt === 'w' ? '<span class="m"> &middot; sold by weight, check the tray</span>' : '');
    return '<b style="display:inline" class="mp-no">&#9888; $' + LIVE.toFixed(2) + ' vs $' + unit.toFixed(2) +
           ' expected (' + (d > 0 ? '+' : '') + Math.round(d * 100) + '%) &mdash; ' + (wt === 'w' ? 'different size tray?' : 'wrong size?') + '</b>';
  }

  function listRows() {
    const L = WALK();
    return '<div class="mp-rows mp-jump">' + L.map((r, n) => {
      const nm = String(r[1]), ov = OVER[nm];
      const mk = n === i ? '<i class="mp-mid">&#9656;</i>'
               : ov ? '<i class="mp-mid">&#9679;</i>'
               : LOG[nm] ? '<i class="mp-ok">&#10003;</i>' : '<i>&nbsp;</i>';
      return '<div data-i="' + n + '"' + (n === i ? ' class="cur"' : '') + '>' + mk +
        '<span class="n">' + r[0] + '&times; ' + esc(nm) +
        (ov ? ' <span class="m">' + (ov.skipBlk != null ? 'skipped' : 'substituted') + '</span>' : '') +
        '</span><span class="p">' + (r[2] ? '$' + r[2].toFixed(2) : '') + '</span></div>';
    }).join('') + '</div>';
  }

  function render(allowLoose) {
    const L = WALK();
    const [qty, name, price, wt] = L[i];
    const act = L[i][6] || '', why = L[i][7] || '';
    const conf = onProduct ? -1 : highlight(allowLoose);
    const match = conf === -1 ? '<b style="display:inline" class="mp-ok">direct link</b>'
      : !conf ? '<span class="mp-no">no match &mdash; search by hand</span>'
      : SOFT ? '<b style="display:inline" class="mp-mid">closest match ' + conf + '% &mdash; CHECK THE SIZE</b>'
      : 'match ' + conf + '%';
    const done = L.filter(r => LOG[r[1]]).length;
    const lastAttn = attnMode && i === L.length - 1;
    el.innerHTML = bar(`${fixMode ? 'Fix' : attnMode ? 'Needs attention' : 'Item'} ${i+1}/${L.length} &middot; ${String(name).replace(/&[a-z]+;/g, ' ').slice(0, 26)}`) + `
      <div class="m">${fixMode
          ? '<b class="mp-mid" style="display:inline">FIXING THE CART</b> &middot; ' + (i+1) + ' of ' + L.length
          : attnMode ? '<b class="mp-no" style="display:inline">NEEDS ATTENTION</b> &middot; ' + (i+1) + ' of ' + L.length + ' flagged by the cart audit'
          : blockName(block) + ' &middot; item ' + (i+1) + ' of ' + L.length + ' &middot; unit ' + (unitsBefore(i)+1) + '&ndash;' + (unitsBefore(i)+qty) + ' of ' + UNITS()}
        ${price ? '&middot; $' + price.toFixed(2) : ''}</div>
      ${OVER[name] ? `<div class="m mp-mid" style="margin:2px 0">override: ${OVER[name].skipBlk != null
          ? 'skipped on ' + blockName(OVER[name].skipBlk).toLowerCase()
          : 'buying <b style="display:inline">' + esc(OVER[name].sub) + '</b> instead'}</div>` : ''}
      <b>${act ? '<span class="' + (act === 'remove' ? 'mp-no' : 'mp-mid') + '">' +
            (act === 'remove' ? 'REMOVE' : act === 'bigger' ? 'BIGGER' : 'SWAP') + '</span> ' : ''}${name}</b>
      ${why ? `<div class="m" style="margin:3px 0 2px">${why}</div>` : ''}
      <div class="m">${qty > 1 ? '<b class="mp-no" style="display:inline">Quantity: '+qty+'</b>' : 'Quantity: 1'}
        &middot; ${act === 'remove' ? '<b class="mp-no" style="display:inline">find it in the cart &mdash; outlined red</b>' : match}${!fixMode && LOG[name] ? ' &middot; <span class="mp-ok">logged</span>' : ''}</div>
      <div class="r">
        <button id="mp-prev">&larr; Back</button>
        <button id="mp-next" class="pri">${act === 'remove' ? 'Removed' : act ? 'Swapped' : lastAttn ? 'Added &mdash; back to the audit' : 'Added'} &rarr;</button>
      </div>
      <div class="r" style="margin-top:5px">
        <button id="mp-scan">Re-scan</button>
        <button id="mp-skip">Skip</button>
        <button id="mp-copy">Copy</button>
      </div>
      <div class="m" style="margin-top:5px">${onProduct ? '' : verdict(qty, price, wt)}</div>
      <div class="r" style="margin-top:7px">
        <button id="mp-all">${showAll ? 'Hide the list' : 'Show all ' + L.length + ' items'}</button>
      </div>
      ${showAll ? listRows() : ''}
      ${!fixMode && !attnMode ? `<div class="r" style="margin-top:7px">
        <button id="mp-wprev"${block > 0 ? '' : ' disabled style="opacity:.45;cursor:default"'}>&larr; ${blockName(Math.max(0, block - 1))}</button>
        <button id="mp-wnext">${blockName(block + 1)} &rarr;</button>
      </div>` : ''}
      <div class="m" style="margin-top:7px">${fixMode
          ? 'Then <a href="/cart">back to the cart</a> to check it off.'
          : attnMode ? 'Click <b style="display:inline">Add</b> yourself, then hit Added &mdash; it goes to the next flagged line, and after the last one back to the audit. &middot; <a href="/cart">back to the audit now</a> &middot; <a href="#" id="mp-tolist">the full list</a> &middot; v' + VERSION
          : 'Click <b style="display:inline">Add</b> yourself, then hit Added. ' + blockName(block) + ' &middot; ' + done + '/' + L.length + ' logged &middot; <a href="/cart">audit the cart</a> &middot; v' + VERSION}
        ${fixMode ? '&middot; <a href="#" id="mp-tolist">back to the full list</a>' : ''}</div>`;
    el.querySelector('#mp-prev').onclick  = () => go(i - 1);
    el.querySelector('#mp-next').onclick  = () => { logAdded(); go(i + 1); };
    el.querySelector('#mp-skip').onclick  = () => go(i + 1);
    el.querySelector('#mp-scan').onclick  = () => { lastConf = render(true); };
    el.querySelector('#mp-copy').onclick  = e => copy(report(), e.target);
    el.querySelector('#mp-all').onclick = () => {
      showAll = !showAll;
      GM_setValue(AKEY, showAll ? '1' : '0');
      render(allowLoose);
    };
    const jump = el.querySelector('.mp-jump');
    if (jump) jump.onclick = e => {
      const row = e.target.closest('[data-i]');
      if (row) go(Number(row.getAttribute('data-i')));
    };
    const wp = el.querySelector('#mp-wprev'), wn = el.querySelector('#mp-wnext');
    if (wp && block > 0) wp.onclick = () => setBlock(block - 1);   // was > 1: '← Setup' drew enabled and did nothing
    if (wn) wn.onclick = () => setBlock(block + 1);
    const tl = el.querySelector('#mp-tolist');
    if (tl) tl.onclick = e => { e.preventDefault(); setMode('list'); };
    wireBar(() => render(allowLoose));
    if (el.classList) el.classList.toggle('mp-wide', showAll);
    return conf === -1 ? 100 : conf;
  }

  if (onCart) {
    let ct = 0, got = 0;
    const cartTick = () => {
      got = renderCart();
      if (++ct < 34 && got === 0) setTimeout(cartTick, 700);
    };
    cartTick();
    let ctm = null;
    new MutationObserver(() => {
      clearTimeout(ctm);
      ctm = setTimeout(() => { if (got === 0) got = renderCart(); }, 500);
    }).observe(document.body, {childList: true, subtree: true});
    return;
  }

  let tries = 0, lastConf = 0;
  function tick() {
    lastConf = render(tries >= 6);
    tries++;
    if (!onProduct && lastConf === 0 && tries < 28) setTimeout(tick, 700);
  }
  tick();
  if (!onProduct) {
    let t = null;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { if (lastConf === 0) lastConf = render(tries >= 6); }, 400);
    }).observe(document.body, {childList: true, subtree: true});
  }
})();
