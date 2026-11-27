import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './style.css';
import QRCode from 'qrcode';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const db = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const emptyIngredient = {
  name: '',
  category: 'วัตถุดิบ',
  price_per_100g: '25',
  weight_options: '50,100,150,200',
  is_available: true
};

const defaultSauceSettings = {
  is_enabled: false, max_cups: 3, cup_capacity: 6,
  min_spoons: 1, max_ingredient_types: 6,
  custom_cup_price: 0, first_cup_free: false,
  free_cup_mode: 'none'
};
const allSpices=['ไม่เผ็ด','เผ็ดน้อย','เผ็ดกลาง','เผ็ดมาก'];
const blankSoup={name:'',description:'',is_available:true,sort_order:0,spice_enabled:true,spice_levels:allSpices};
const money = value => Number(value || 0).toFixed(2);
const newSauceRecipe = { name: '', description: '', price: '0', is_available: true, sort_order: '0' };
const newSauceIngredient = { name: '', description: '', price_per_spoon: '0', max_spoons: '3', is_available: true, sort_order: '0' };

function promptpayPayload(phone, amount) {
  if (!/^0[0-9]{9}$/.test(phone) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('ข้อมูล QR ไม่ถูกต้อง');
  const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;
  const account = tlv('00','A000000677010111') + tlv('01','0066'+phone.slice(1));
  const body = '000201010212' + tlv('29',account) + '5303764' + tlv('54',Number(amount).toFixed(2)) + '5802TH6304';
  let crc = 0xffff;
  for (const c of body) {
    crc ^= c.charCodeAt(0) << 8;
    for (let i=0;i<8;i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return body + crc.toString(16).toUpperCase().padStart(4,'0');
}

function App() {
  const [paymentMethod,setPaymentMethod] = useState('cash');
  const [fulfillment,setFulfillment]=useState('pickup');
  const [codType,setCodType]=useState('cash');
  const [codBusy,setCodBusy]=useState(false);
  async function payCod(h,retry){
    if(codBusy || uploading || pending || payment) return;
    setCodBusy(true);
    try {
      const args={p_order_id:h.id,p_tracking_token:h.token};
      if(retry){const x=await db.rpc('retry_cod_payment',args);if(x.error||x.data!==true)throw new Error(x.error?.message||'ลองใหม่ไม่ได้');}
      const {data,error}=await db.rpc('prepare_cod_payment',args);
      if(error||!data?.success)throw new Error(error?.message||'ยังไม่สามารถชำระเงินได้');
      setSlip(null);setPayment({...data,payment_method:'cod',payment_status:'pending'});setPage('shop');
    }catch(e){setNotice(e.message);}finally{setCodBusy(false);}
  }
  async function payAccepted(h){
    if(codBusy || uploading || pending || payment) return;
    setCodBusy(true);
    try {
      const {data,error}=await db.rpc('prepare_accepted_payment',{p_order_id:h.id,p_tracking_token:h.token});
      if(error||!data?.success)throw new Error(error?.message||'ยังไม่สามารถชำระเงินได้');
      setSlip(null);setPayment({...data,payment_method:'promptpay'});setPage('shop');
    }catch(e){setNotice(e.message);}finally{setCodBusy(false);}
  }
  const [payment,setPayment] = useState(null);
  const [qr,setQr] = useState('');
  const [slip,setSlip] = useState(null);
  const [uploading,setUploading] = useState(false);
  const uploadLock = React.useRef(false);
  const slipInput = React.useRef(null);
  useEffect(() => {
    let active=true;
    setQr('');
    if (payment?.payment_status === 'pending' && payment.promptpay_id && payment.upload_token) {
      Promise.resolve().then(()=>QRCode.toDataURL(promptpayPayload(payment.promptpay_id,payment.total_amount),{width:640,margin:4,errorCorrectionLevel:'M'})).then(url=>{if(active)setQr(url);}).catch(()=>{if(active)setNotice('สร้าง QR ไม่สำเร็จ กรุณาติดต่อร้าน');});
    }
    return ()=>{active=false;};
  },[payment]);
  async function uploadSlip() {
    if (!payment?.upload_token || uploadLock.current || !slip) return;
    if (!['image/jpeg','image/png','image/webp'].includes(slip.type) || !slip.size || slip.size>5*1024*1024) return setNotice('กรุณาเลือกรูป JPG PNG หรือ WEBP ไม่เกิน 5 MB');
    uploadLock.current=true; setUploading(true);
    try {
      const form=new FormData();
      form.append('order_id',payment.order_id);
      form.append('upload_token',payment.upload_token);
      form.append('file',slip);
      const {data,error}=await db.functions.invoke('upload-payment-slip',{body:form});
      if(error || !data?.success || data.payment_status!=='reviewing') throw new Error('ยังยืนยันการส่งสลิปไม่ได้ กรุณากดตรวจสอบสถานะก่อนส่งซ้ำ');
      setPayment({...payment,payment_status:'reviewing',upload_token:null,promptpay_id:null});
      sessionStorage.removeItem('mala-v5-pending'); setPending(null); setSlip(null);
      setNotice('ส่งสลิปแล้ว รอร้านตรวจสอบ');
    } catch(e){setNotice(e.message);} finally {uploadLock.current=false;setUploading(false);}
  }

  const [page, setPage] = useState('shop');
  const [history,setHistory] = useState(()=>{
    try { const h=JSON.parse(localStorage.getItem('mala-tracking-v1')||'[]'); return Array.isArray(h)?h:[]; } catch { return []; }
  });
  const [tracked,setTracked] = useState({});
  const [trackingError,setTrackingError] = useState('');
  function rememberOrder(data,token) {
    if (!data.order_id || !/^[a-f0-9]{64}$/.test(token||'')) return;
    const entry={id:data.order_id,token,number:data.order_number};
    setHistory(old=>[entry,...old.filter(x=>x.id!==entry.id)].slice(0,30));
  }
  useEffect(()=>{try {localStorage.setItem('mala-tracking-v1',JSON.stringify(history));} catch {setTrackingError('ไม่สามารถบันทึกประวัติบนอุปกรณ์นี้ได้');}},[history]);
  useEffect(()=>{
    if(page!=='tracking'||!db) return;
    let active=true,busy=false;
    async function refresh(){
      if(busy||document.hidden) return;
      busy=true;
      try {
        const results=await Promise.all(history.map(async h=>{
          const {data,error}=await db.rpc('track_order',{p_order_id:h.id,p_tracking_token:h.token});
          return [h.id,error?{error:true}:data||{missing:true}];
        }));
        if(active)setTracked(Object.fromEntries(results));
      } catch {if(active)setTrackingError('เชื่อมต่อไม่ได้ กรุณารอสักครู่');}
      finally {busy=false;}
    }
    refresh(); const timer=setInterval(refresh,10000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[page,history]);

  const paymentPanel = React.useRef(null);
  useEffect(() => {
    if (page === 'shop' && payment) paymentPanel.current?.scrollIntoView({behavior:'smooth',block:'start'});
  }, [page, payment?.order_id, payment?.payment_status, qr]);
  const [ingredients, setIngredients] = useState([]);
  const [soups, setSoups] = useState([]);
  const [allSoups,setAllSoups]=useState([]);
  const [dryConfig,setDryConfig]=useState({spice_enabled:true,spice_levels:allSpices});
  const [soupForm,setSoupForm]=useState({...blankSoup});
  const [dryForm,setDryForm]=useState({spice_enabled:true,spice_levels:allSpices});
  const [menuReady,setMenuReady]=useState(false);
  const [sauceSettings, setSauceSettings] = useState(defaultSauceSettings);
  const [sauceRecipes, setSauceRecipes] = useState([]);
  const [sauceIngredients, setSauceIngredients] = useState([]);
  const [sauceCups, setSauceCups] = useState([]);
  const [recipeChoice, setRecipeChoice] = useState('');
  const [mixSpoons, setMixSpoons] = useState({});
  const [sauceError, setSauceError] = useState('');
  const [sauceEditor, setSauceEditor] = useState('recipes');
  const [sauceEditId, setSauceEditId] = useState(null);
  const [sauceForm, setSauceForm] = useState({ ...newSauceRecipe });
  const [selectedWeights, setSelectedWeights] = useState({});
  const [cart, setCart] = useState([]);
  const [bowls, setBowls] = useState([]);
  const [method, setMethod] = useState('soup');
  const [pending, setPending] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('mala-v5-pending') || 'null'); } catch { return null; }
  });
  const submitLock = React.useRef(false);
  const [soup, setSoup] = useState('');
  const [spice, setSpice] = useState('เผ็ดกลาง');
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [clock,setClock]=useState(Date.now());
  const [historySearch,setHistorySearch]=useState('');
  const [historyDate,setHistoryDate]=useState('');
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return ()=>clearInterval(t);},[]);
  const closedOrder=o=>['completed','cancelled'].includes(o.order_status);
  const activeOrders=orders.filter(o=>!closedOrder(o)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const pastOrders=orders.filter(o=>closedOrder(o)&&String(o.order_number).toLowerCase().includes(historySearch.toLowerCase())&&(!historyDate||new Date(o.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})===historyDate));
  const elapsed=o=>{const n=Math.max(0,Math.floor((clock-new Date(o.created_at).getTime())/1000));return Number.isFinite(n)?`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`:'-';};

  const [adminAccount, setAdminAccount] = useState(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [rejectForm,setRejectForm]=useState(null);
  const orderLock = React.useRef(false);
  const owner = adminAccount?.user_id === session?.user?.id && adminAccount?.is_active === true && adminAccount?.role === 'owner';
  const canManage = owner || (adminAccount?.user_id === session?.user?.id && adminAccount?.is_active === true && adminAccount?.role === 'staff' && String(adminAccount?.permissions?.manage_orders) === 'true');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [rejectSuccess,setRejectSuccess]=useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [itemForm, setItemForm] = useState({
    ...emptyIngredient
  });

  async function loadMenu() {
    if (!db) return;

    const [ingredientResult, soupResult, dryResult] = await Promise.all([
      db.from('ingredients').select('*').order('name'),
      db.from('soups').select('*').order('sort_order').order('name'),
      db.from('shop_settings').select('dry_spice_enabled,dry_spice_levels').eq('id',1).single()
    ]);

    if (ingredientResult.error || soupResult.error || dryResult.error) {
      setNotice(
        ingredientResult.error?.message ||
        soupResult.error?.message || dryResult.error?.message
      );
      return;
    }

    setIngredients(ingredientResult.data || []);
    setAllSoups(soupResult.data||[]);
    const d={spice_enabled:dryResult.data.dry_spice_enabled,spice_levels:dryResult.data.dry_spice_levels};
    setDryConfig(d);setDryForm(d);setMenuReady(true);

    const activeSoups = (soupResult.data || []).filter(
      x => x.is_available !== false
    );

    setSoups(activeSoups);

    setSoup(current =>
      activeSoups.some(x => x.name === current)
        ? current
        : activeSoups[0]?.name || ''
    );
  }

  const spiceConfig=method==='dry'?dryConfig:soups.find(x=>x.name===soup);
  const spiceEnabled=spiceConfig?.spice_enabled!==false;
  const allowedSpices=spiceConfig?.spice_levels||allSpices;
  const effectiveSpice=spiceEnabled?(allowedSpices.includes(spice)?spice:allowedSpices[0]||null):null;
  function validSpice(b){const c=b.cooking_method==='dry'?dryConfig:soups.find(x=>x.name===b.soup_name);return !!c&&(c.spice_enabled===false?b.spice_level==null:(c.spice_levels||allSpices).includes(b.spice_level));}
  const invalidSpice=!menuReady||bowls.some(b=>!validSpice(b.payload))||(cart.length>0&&!validSpice({cooking_method:method,soup_name:soup,spice_level:effectiveSpice}));
  async function saveSoup(event,dry=false){
    event.preventDefault();if(!owner||saving)return;
    const f=dry?dryForm:soupForm;
    if(f.spice_enabled&&!f.spice_levels.length)return setNotice('เลือกระดับความเผ็ดอย่างน้อย 1 ระดับ');
    if(!dry&&(!f.name.trim()||!Number.isSafeInteger(Number(f.sort_order))))return setNotice('ตรวจสอบชื่อและลำดับ');
    if(!window.confirm('การบันทึกมีผลต่อฐานข้อมูลเว็บไซต์หลักด้วย ยืนยันเมื่อพร้อมใช้งานทั้งสองเว็บไซต์เท่านั้น'))return;
    setSaving(true);try{
      const p={spice_enabled:f.spice_enabled,spice_levels:f.spice_levels};
      const q=dry?db.from('shop_settings').update({dry_spice_enabled:p.spice_enabled,dry_spice_levels:p.spice_levels}).eq('id',1):f.id?db.from('soups').update({...p,name:f.name.trim(),description:f.description||null,is_available:f.is_available,sort_order:Number(f.sort_order)}).eq('id',f.id):db.from('soups').insert({...p,name:f.name.trim(),description:f.description||null,is_available:f.is_available,sort_order:Number(f.sort_order)});
      const {data,error}=await q.select();if(error||!data?.length)throw new Error(error?.message||'ไม่มีสิทธิ์');await loadMenu();setSoupForm({...blankSoup});setNotice('บันทึกสำเร็จ');
    }catch(e){setNotice(e.message);}finally{setSaving(false);}
  }
  async function deleteSoup(item){if(!owner||saving||!window.confirm('ลบน้ำซุป '+item.name+' จากฐานข้อมูลทั้งสองเว็บไซต์?'))return;setSaving(true);try{const {data,error}=await db.from('soups').delete().eq('id',item.id).select();if(error||!data?.length)throw new Error(error?.message||'ไม่มีสิทธิ์');await loadMenu();setSoupForm({...blankSoup});setNotice('ลบแล้ว');}catch(e){setNotice(e.message);}finally{setSaving(false);}}
  function spiceFields(f,set){return <><label><input type="checkbox" checked={f.spice_enabled} onChange={e=>set(o=>({...o,spice_enabled:e.target.checked}))}/> เปิดให้เลือกความเผ็ด</label>{f.spice_enabled&&allSpices.map(l=><label key={l}><input type="checkbox" checked={f.spice_levels.includes(l)} onChange={e=>set(o=>({...o,spice_levels:allSpices.filter(x=>x===l?e.target.checked:o.spice_levels.includes(x))}))}/> {l}</label>)}</>;}
  async function loadSauces() {
    if (!db) return;
    const [settings, recipes, components] = await Promise.all([
      db.from('sauce_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('sauce_recipes').select('*').order('sort_order').order('id'),
      db.from('sauce_ingredients').select('*').order('sort_order').order('id')
    ]);
    if (settings.error || recipes.error || components.error) {
      setSauceError(settings.error?.message || recipes.error?.message || components.error?.message);
      return;
    }
    setSauceError('');
    setSauceSettings(settings.data || defaultSauceSettings);
    setSauceRecipes(recipes.data || []);
    setSauceIngredients(components.data || []);
  }

  useEffect(() => {
    if (!db) return;

    loadMenu();
    loadSauces();

    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: authListener } =
      db.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
      });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      setIsAdmin(false);
      setAdminAccount(null);

      if (!db || !session?.user?.id) {
        setCheckingAdmin(false);
        return;
      }

      setCheckingAdmin(true);

      const { data, error } = await db
        .from('admin_users')
        .select('*')
        .eq('user_id', session.user.id)
        .limit(1);

      if (!cancelled) {
        const account = !error && data?.[0]?.is_active === true ? data[0] : null;
        setAdminAccount(account);
        setIsAdmin(Boolean(account));
        setCheckingAdmin(false);

        if (error) {
          setNotice(
            'ตรวจสอบสิทธิ์ผู้ดูแลไม่ได้: ' +
            error.message
          );
        }
      }
    }

    checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const totalWeight = cart.reduce(
    (sum, item) => sum + item.grams,
    0
  );

  const totalPrice = cart.reduce(
    (sum, item) => sum + item.price,
    0
  );

  const cartCount = cart.length;
  const sauceEnabled = sauceSettings.is_enabled === true;
  const availableRecipes = sauceRecipes.filter(x => x.is_available !== false);
  const availableSauceIngredients = sauceIngredients.filter(x => x.is_available !== false);
  const maxCups = Math.min(20, Math.max(0, Number(sauceSettings.max_cups) || 0));

  function priceSauceCup(cup, index, offset = bowls.reduce((n,b)=>n+b.payload.sauces.length,0)) {
    if (Array.isArray(sauceSettings.cup_prices)) return Number(sauceSettings.cup_prices[offset+index] || 0);
    let price = 0;
    if (cup.type === 'recipe') {
      const recipe = sauceRecipes.find(x => String(x.id) === String(cup.recipe_id));
      price = Number(recipe?.price || 0);
    } else {
      price = Number(sauceSettings.custom_cup_price || 0);
      for (const part of cup.ingredients || []) {
        const ingredient = sauceIngredients.find(x => String(x.id) === String(part.ingredient_id));
        price += Number(ingredient?.price_per_spoon || 0) * Number(part.spoons);
      }
    }
    if (index + offset === 0) {
      const mode = sauceSettings.free_cup_mode;
      if (mode === 'full_cup' || (mode === 'recipe_only' && cup.type === 'recipe')) return 0;
      if (mode === 'base_only' && cup.type === 'custom') {
        return Math.max(0, price - Number(sauceSettings.custom_cup_price || 0));
      }
    }
    return Math.round(price * 100) / 100;
  }

  const sauceTotal = sauceCups.reduce((sum, cup, index) => sum + priceSauceCup(cup, index), 0);
  const savedWeight = bowls.reduce((n,b) => n+b.weight,0);
  let cupOffset=0;
  const bowlPrices=bowls.map(b=>{const offset=cupOffset;cupOffset+=b.payload.sauces.length;return b.foodPrice+b.payload.sauces.reduce((n,c,i)=>n+priceSauceCup(c,i,offset),0);});
  const savedPrice = bowlPrices.reduce((n,p)=>n+p,0);
  function validCup(c) {
    if (!sauceEnabled) return false;
    if(c.type==='recipe') return availableRecipes.some(x=>String(x.id)===String(c.recipe_id));
    if(c.type!=='custom') return false;
    const parts=c.ingredients||[], total=parts.reduce((n,p)=>n+Number(p.spoons),0);
    return parts.length>0 && parts.length<=Number(sauceSettings.max_ingredient_types) && total>=Number(sauceSettings.min_spoons) && total<=Number(sauceSettings.cup_capacity) && parts.every(p=>availableSauceIngredients.some(x=>String(x.id)===String(p.ingredient_id)&&Number(p.spoons)>0&&Number(p.spoons)<=Number(x.max_spoons)));
  }
  const invalidSauces=[...bowls.flatMap(b=>b.payload.sauces),...sauceCups].some(c=>!validCup(c)) || cupOffset+sauceCups.length>maxCups;
  function updateCup(key,patch){setSauceCups(old=>old.map(c=>c.key===key?{...c,...patch}:c));}
  function changeSpoons(c,item,delta){
    const parts=c.ingredients||[], count=Number(parts.find(p=>String(p.ingredient_id)===String(item.id))?.spoons||0), next=count+delta;
    if(next<0 || (delta>0 && (item.is_available===false || next>Number(item.max_spoons) || parts.reduce((n,p)=>n+Number(p.spoons),0)+delta>Number(sauceSettings.cup_capacity) || (!count&&parts.length>=Number(sauceSettings.max_ingredient_types)))))return;
    updateCup(c.key,{ingredients:[...parts.filter(p=>String(p.ingredient_id)!==String(item.id)),...(next>0?[{ingredient_id:item.id,spoons:next}]:[])]});
  }
  const grandTotal = savedPrice + totalPrice + sauceTotal;
  function currentBowl() {
    return { cooking_method: method, ...(method === 'soup' ? {soup_name:soup} : {}), spice_level:effectiveSpice,
      items:cart.map(i=>({ingredient_id:i.ingredientId,weight_grams:i.grams})),
      sauces:sauceCups.map(c=>c.type==='recipe'?{type:'recipe',recipe_id:c.recipe_id}:{type:'custom',ingredients:c.ingredients}) };
  }
  function addBowl() {
    if (invalidSpice || invalidSauces || !cart.length || cart.length>40 || (method==='soup'&&!soup) || bowls.length>=9) return;
    setBowls(old=>[...old,{key:crypto.randomUUID(),payload:currentBowl(),weight:totalWeight,foodPrice:totalPrice,price:totalPrice+sauceTotal}]);
    setCart([]); setSauceCups([]); setMixSpoons({});
  }

  function addRecipeCup() {
    if (!sauceEnabled || sauceCups.length + bowls.reduce((n,b)=>n+b.payload.sauces.length,0) >= maxCups) return setNotice('จำนวนถ้วยน้ำจิ้มเต็มแล้ว');
    const recipe = availableRecipes.find(x => String(x.id) === String(recipeChoice || availableRecipes[0]?.id));
    if (!recipe) return setNotice('กรุณาเลือกสูตรน้ำจิ้ม');
    setSauceCups(current => [...current, { key: crypto.randomUUID(), type: 'recipe', recipe_id: recipe.id, name: recipe.name }]);
    setNotice('เพิ่มน้ำจิ้มสูตรร้านแล้ว');
  }

  function addCustomCup() {
    if (!sauceEnabled || sauceCups.length + bowls.reduce((n,b)=>n+b.payload.sauces.length,0) >= maxCups) return setNotice('จำนวนถ้วยน้ำจิ้มเต็มแล้ว');
    const parts = Object.entries(mixSpoons).filter(([, spoons]) => Number(spoons) > 0).map(([ingredient_id, spoons]) => ({ ingredient_id: Number(ingredient_id), spoons: Number(spoons) }));
    const total = parts.reduce((sum, part) => sum + part.spoons, 0);
    if (!parts.length || total < Number(sauceSettings.min_spoons)) return setNotice('จำนวนช้อนยังไม่ถึงขั้นต่ำ');
    if (total > Number(sauceSettings.cup_capacity)) return setNotice('จำนวนช้อนเกินความจุถ้วย');
    if (parts.length > Number(sauceSettings.max_ingredient_types)) return setNotice('เลือกชนิดส่วนผสมเกินกำหนด');
    if (parts.some(part => {
      const ingredient = availableSauceIngredients.find(x => Number(x.id) === part.ingredient_id);
      return !ingredient || !Number.isFinite(part.spoons) || part.spoons > Number(ingredient.max_spoons);
    })) return setNotice('จำนวนช้อนของส่วนผสมไม่ถูกต้อง');
    setSauceCups(current => [...current, { key: crypto.randomUUID(), type: 'custom', ingredients: parts, name: 'น้ำจิ้มผสมเอง' }]);
    setMixSpoons({});
    setNotice('เพิ่มน้ำจิ้มผสมเองแล้ว');
  }

  function sauceCupLabel(cup) {
    if (!cup.type) return 'ยังไม่ได้เลือก';
    if (cup.type === 'recipe') return cup.name || 'ยังไม่ได้เลือกสูตร';
    return 'ผสมเอง: ' + (cup.ingredients || []).map(part => {
      const item = sauceIngredients.find(x => String(x.id) === String(part.ingredient_id));
      return `${item?.name || 'ส่วนผสม'} ${part.spoons} ช้อน`;
    }).join(', ');
  }

  async function saveSauceSettings(event) {
    event.preventDefault();
    if (!isAdmin || saving || !db) return;
    const s = sauceSettings;
    if (!owner) return;
    if (Array.isArray(s.cup_prices) && !window.confirm("การเปิดใช้ราคาใหม่มีผลกับฐานข้อมูลเว็บไซต์หลักด้วย ยืนยันเฉพาะเมื่อเว็บไซต์หลักรองรับแล้ว?")) return;
    const payload = {
      id: 1, is_enabled: Boolean(s.is_enabled),
      cup_prices: Array.isArray(s.cup_prices) ? s.cup_prices.map(Number) : null,
      max_cups: Number(s.max_cups), cup_capacity: Number(s.cup_capacity),
      min_spoons: Number(s.min_spoons), max_ingredient_types: Number(s.max_ingredient_types),
      custom_cup_price: Number(s.custom_cup_price),
      first_cup_free: Boolean(s.first_cup_free), free_cup_mode: s.free_cup_mode
    };
    if ((payload.cup_prices !== null && (payload.max_cups < 1 || payload.max_cups > 10 || payload.cup_prices.length !== payload.max_cups || s.cup_prices.some(x=>String(x).trim()==='' || !Number.isFinite(Number(x)) || Number(x)<0 || Math.abs(Number(x)*100-Math.round(Number(x)*100))>0.000001))) || !Number.isInteger(payload.max_cups) || payload.max_cups < 0 || payload.max_cups > 10 ||
        !Number.isFinite(payload.cup_capacity) || payload.cup_capacity <= 0 || payload.cup_capacity > 20 ||
        !Number.isFinite(payload.min_spoons) || payload.min_spoons < 0 || payload.min_spoons > payload.cup_capacity ||
        !Number.isInteger(payload.max_ingredient_types) || payload.max_ingredient_types < 1 ||
        !Number.isFinite(payload.custom_cup_price) || payload.custom_cup_price < 0) {
      return setNotice('กรุณาตรวจสอบค่าการตั้งค่าน้ำจิ้ม');
    }
    setSaving(true);
    const { error } = await db.from('sauce_settings').upsert(payload, { onConflict: 'id' });
    setSaving(false);
    if (error) return setNotice('บันทึกไม่สำเร็จ: ' + error.message);
    await loadSauces();
    setNotice('บันทึกการตั้งค่าน้ำจิ้มแล้ว');
  }

  function beginSauceEdit(type, item = null) {
    setSauceEditor(type);
    setSauceEditId(item?.id ?? null);
    setSauceForm(item ? { ...item } : { ...(type === 'recipes' ? newSauceRecipe : newSauceIngredient) });
  }

  async function saveSauceEntry(event) {
    event.preventDefault();
    if (!db || !isAdmin || saving) return;
    const isRecipe = sauceEditor === 'recipes';
    const table = isRecipe ? 'sauce_recipes' : 'sauce_ingredients';
    const payload = {
      name: String(sauceForm.name || '').trim(),
      description: String(sauceForm.description || '').trim() || null,
      is_available: Boolean(sauceForm.is_available),
      sort_order: Number(sauceForm.sort_order || 0),
      ...(isRecipe ? { price: Number(sauceForm.price) } : {
        price_per_spoon: Number(sauceForm.price_per_spoon), max_spoons: Number(sauceForm.max_spoons)
      })
    };
    if (!payload.name || !Number.isInteger(payload.sort_order) ||
        (isRecipe ? !Number.isFinite(payload.price) || payload.price < 0 :
          !Number.isFinite(payload.price_per_spoon) || payload.price_per_spoon < 0 ||
          !Number.isFinite(payload.max_spoons) || payload.max_spoons < 0)) {
      return setNotice('กรุณากรอกข้อมูลน้ำจิ้มให้ถูกต้อง');
    }
    setSaving(true);
    const query = sauceEditId == null
      ? db.from(table).insert(payload).select()
      : db.from(table).update(payload).eq('id', sauceEditId).select();
    const { data, error } = await query;
    setSaving(false);
    if (error || !data?.length) return setNotice('บันทึกไม่สำเร็จ: ' + (error?.message || 'ไม่มีสิทธิ์แก้ไข'));
    await loadSauces();
    beginSauceEdit(sauceEditor);
    setNotice('บันทึกข้อมูลน้ำจิ้มแล้ว');
  }

  async function toggleSauceEntry(type, item) {
    if (!db || !isAdmin || saving) return;
    setSaving(true);
    const table = type === 'recipes' ? 'sauce_recipes' : 'sauce_ingredients';
    const { data, error } = await db.from(table).update({ is_available: item.is_available === false }).eq('id', item.id).select();
    setSaving(false);
    if (error || !data?.length) return setNotice('เปลี่ยนสถานะไม่สำเร็จ: ' + (error?.message || 'ไม่มีสิทธิ์'));
    await loadSauces();
    setNotice('เปลี่ยนสถานะน้ำจิ้มแล้ว');
  }


  function getWeight(item) {
    const options = item.weight_options || [];

    return Number(
      selectedWeights[item.id] || options[0] || 0
    );
  }

  function addToCart(item) {
    if (item.is_available === false) {
      setNotice('สินค้านี้หมดแล้ว');
      return;
    }

    const weight = getWeight(item);

    if (
      !Number.isSafeInteger(weight) ||
      weight <= 0 ||
      !(item.weight_options || []).includes(weight)
    ) {
      setNotice('กรุณาเลือกน้ำหนักที่ถูกต้อง');
      return;
    }

    const price =
      weight * Number(item.price_per_100g) / 100;

    setCart(current => [
      ...current,
      {
        cartId:
          Date.now().toString() +
          '-' +
          Math.random().toString(36).slice(2),
        ingredientId: item.id,
        name: item.name,
        grams: weight,
        price
      }
    ]);

    setNotice(
      'เพิ่ม ' + item.name +
      ' ' + weight + ' กรัม ลงตะกร้าแล้ว'
    );
  }

  function removeFromCart(cartId) {
    setCart(current =>
      current.filter(item => item.cartId !== cartId)
    );
  }

  function clearCart() {
    setCart([]);
  }

  async function submitOrder() {
    if (!db || submitLock.current) return;
    if (!pending && (invalidSpice || invalidSauces || (!cart.length && !bowls.length) || cart.length>40 || (cart.length && method==='soup'&&!soup) || (!cart.length && sauceCups.length))) return;
    submitLock.current=true; setSubmitting(true);
    try {
      const payload = pending || {
        idempotency_key:crypto.randomUUID(),
        request_token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),
        acceptance_required:true,
        payment_method:paymentMethod,
        fulfillment_type:fulfillment,
        ...(paymentMethod==='cod'?{cod_payment_type:codType}:{}),
        bowls:[...bowls.map(b=>b.payload),...(cart.length?[currentBowl()]:[])]
      };
      sessionStorage.setItem('mala-v5-pending',JSON.stringify(payload)); setPending(payload);
      const {data,error}=await db.functions.invoke('create-order-v5',{body:payload});
      if(error || !data?.success) throw new Error('ยังไม่ได้รับการยืนยัน กรุณาลองส่งคำขอเดิมอีกครั้ง');
      rememberOrder(data,data.tracking_token || payload.request_token);
      if(data.payment_method==='promptpay' && !data.waiting_for_acceptance && data.upload_token) {
        setPayment(data);
        if(data.payment_status!=='pending') {sessionStorage.removeItem('mala-v5-pending');setPending(null);}
        setCart([]);setBowls([]);setSauceCups([]);
        setNotice('ออเดอร์ '+data.order_number+' · '+money(data.total_amount)+' บาท');
        return;
      }
      sessionStorage.removeItem('mala-v5-pending'); setPending(null);
      setCart([]); setBowls([]); setSauceCups([]);
      setPage('tracking');
      if(data.waiting_for_acceptance){setNotice('ส่งออเดอร์แล้ว รอร้านตอบรับ');return;}
      setNotice('รับออเดอร์ '+data.order_number+' ยอดชำระทั้งหมด '+money(data.total_amount)+' บาท '+(data.payment_method==='cod'?'ชำระเงินปลายทางเมื่อได้รับอาหาร':'กรุณาชำระเงินสดที่ร้าน'));
    } catch(e) { setNotice(e.message); }
    finally { submitLock.current=false; setSubmitting(false); }
  }

  async function login(event) {
    event.preventDefault();

    if (!db) return;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    setNotice(
      error ? error.message : 'เข้าสู่ระบบแล้ว'
    );

    setPassword('');
  }

  async function logout() {
    if (!db) return;

    const { error } = await db.auth.signOut();

    if (error) {
      setNotice(error.message);
      return;
    }

    setIsAdmin(false);
    setAdminAccount(null);
    setOrders([]);
    setNotice('ออกจากระบบแล้ว');
  }

  async function loadOrders() {
    if (!db || !session || !isAdmin) return;

    const { data, error } = await db
      .from('orders')
      .select('*,order_items(*),order_bowls(*)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      setNotice(error.message);
      return;
    }

    const orderList = data || [];
    // order_sauces has its own RLS policy; show a warning if admin SELECT is denied.
    const ids = orderList.map(x => x.id);
    if (!ids.length) return setOrders([]);
    const saucesResult = await db.from('order_sauces').select('*').in('order_id', ids).order('cup_number');
    if (saucesResult.error) {
      setNotice('โหลดออเดอร์ได้ แต่โหลดน้ำจิ้มไม่ได้: ' + saucesResult.error.message);
    }
    const sauceMap = {};
    for (const cup of saucesResult.data || []) {
      (sauceMap[cup.order_id] ||= []).push(cup);
    }
    setOrders(orderList.map(x => ({ ...x, order_sauces: sauceMap[x.id] || [] })));
  }

  async function orderAction(order, action, approve) {
    if (!db || !session || !isAdmin || orderLock.current) return;
    const paymentAction = ['review_order_payment','confirm_cash_payment','confirm_cod_payment'].includes(action);
    if (paymentAction ? !owner : !canManage) return;
    if (paymentAction && !window.confirm(action === 'review_order_payment' && !approve ? 'ยืนยันปฏิเสธสลิปนี้?' : `ยืนยันว่าได้รับเงินจริง ${money(order.total_amount)} บาท สำหรับ ${order.order_number} แล้ว?`)) return;
    orderLock.current = true; setOrderBusy(true);
    try {
      const args = {p_order_id: order.id};
      if (action === 'review_order_payment') args.p_approve = approve;
      if (action === 'reject_customer_order') args.p_reason = approve;
      const {data,error} = await db.rpc(action,args);
      if (error) throw error;
      if (data !== true) throw new Error('สถานะไม่ตรงกับขั้นตอน กรุณาโหลดออเดอร์ใหม่');
      if(action==='reject_customer_order') { setRejectForm(null); setNotice(''); setRejectSuccess({number:order.order_number,reason:approve}); }
      else setNotice('อัปเดตออเดอร์สำเร็จ');
      await loadOrders();
    } catch(e) { setNotice(e.message); }
    finally { orderLock.current = false; setOrderBusy(false); }
  }

  async function openSlip(order) {
    if (!owner || !order.slip_url || orderLock.current) return;
    const tab = window.open('about:blank','_blank');
    if (!tab) return setNotice('กรุณาอนุญาตป๊อปอัปเพื่อเปิดสลิป');
    tab.opener = null;
    try {
      const {data,error} = await db.storage.from('payment-slips').createSignedUrl(order.slip_url,60);
      if (error || !data?.signedUrl) throw new Error(error?.message || 'เปิดสลิปไม่ได้');
      tab.location.replace(data.signedUrl);
    } catch(e) { tab.close(); setNotice(e.message); }
  }

  function newIngredient() {
    setEditingId(null);
    setItemForm({ ...emptyIngredient });
  }

  function editIngredient(item) {
    setEditingId(item.id);

    setItemForm({
      name: item.name || '',
      category: item.category || 'วัตถุดิบ',
      price_per_100g:
        String(item.price_per_100g ?? 25),
      weight_options:
        (item.weight_options || []).join(','),
      is_available: item.is_available !== false
    });
  }

  function changeItem(field, value) {
    setItemForm(current => ({
      ...current,
      [field]: value
    }));
  }

  async function saveIngredient(event) {
    event.preventDefault();

    if (!db || !session || !isAdmin || saving) return;

    const name = itemForm.name.trim();
    const category = itemForm.category.trim();
    const price = Number(itemForm.price_per_100g);

    const weights = itemForm.weight_options
      .split(',')
      .map(x => Number(x.trim()));

    if (!name || !category) {
      setNotice('กรุณากรอกชื่อและหมวดหมู่');
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      setNotice('ราคาต้องมากกว่า 0 บาท');
      return;
    }

    if (
      !weights.length ||
      weights.some(x =>
        !Number.isSafeInteger(x) ||
        x <= 0 ||
        x > 10000
      )
    ) {
      setNotice(
        'น้ำหนักต้องเป็นจำนวนเต็มบวก เช่น 50,100,150'
      );
      return;
    }

    const payload = {
      name,
      category,
      price_per_100g: price,
      weight_options:
        [...new Set(weights)].sort((a, b) => a - b),
      is_available: itemForm.is_available
    };

    setSaving(true);

    try {
      const result = editingId
        ? await db
            .from('ingredients')
            .update(payload)
            .eq('id', editingId)
            .select()
        : await db
            .from('ingredients')
            .insert(payload)
            .select();

      if (result.error) throw result.error;

      if (!result.data?.length) {
        throw new Error(
          'ไม่สามารถบันทึกได้ กรุณาตรวจสอบสิทธิ์ Supabase'
        );
      }

      await loadMenu();
      newIngredient();

      setNotice('บันทึกข้อมูลวัตถุดิบสำเร็จ');
    } catch (error) {
      setNotice(
        'บันทึกไม่สำเร็จ: ' + error.message
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleIngredient(item) {
    if (!db || !session || !isAdmin || saving) return;

    setSaving(true);

    const { data, error } = await db
      .from('ingredients')
      .update({
        is_available: item.is_available === false
      })
      .eq('id', item.id)
      .select();

    setSaving(false);

    if (error || !data?.length) {
      setNotice(
        'เปลี่ยนสถานะไม่สำเร็จ: ' +
        (error?.message || 'ไม่มีสิทธิ์แก้ไข')
      );
      return;
    }

    await loadMenu();

    setNotice(
      item.is_available === false
        ? 'เปิดขายสินค้าแล้ว'
        : 'ปิดขายสินค้าแล้ว หน้าร้านจะแสดงสินค้าหมด'
    );
  }

  const groupedIngredients = useMemo(() => {
    const groups = {};

    for (const item of ingredients) {
      const category = item.category || 'วัตถุดิบ';

      if (!groups[category]) {
        groups[category] = [];
      }

      groups[category].push(item);
    }

    return groups;
  }, [ingredients]);

  return (
    <>
      <header>
        <nav>
          <b>麻辣烫 · MALA TANG</b>

          <button onClick={()=>setPage('tracking')}>ติดตามออเดอร์</button>
          <button
            onClick={() =>
              setPage(
                page === 'shop' ? 'admin' : 'shop'
              )
            }
          >
            {page === 'shop' ? 'หลังร้าน' : 'หน้าร้าน'}
          </button>
        </nav>

        <h1>หม่าล่าทั่ง</h1>
        <p>เลือกวัตถุดิบ ชั่งน้ำหนัก อร่อยตามใจ</p>
        <span className="price">
          เลือกกรัมแล้วเพิ่มใส่ตะกร้า
        </span>
      </header>

      <main>
        {!db ? (
          <section className="panel">
            <h2>ยังไม่ได้เชื่อม Supabase</h2>
            <p>กรุณาตรวจสอบ Environment Variables</p>
          </section>
        ) : page === 'tracking' ? (
          <section className="panel">
            <h2>ติดตามออเดอร์</h2>
            <button onClick={()=>setPage('shop')}>กลับหน้าสั่งอาหาร</button>
            <p>อัปเดตอัตโนมัติทุก 10 วินาที · ประวัติบนเบราว์เซอร์นี้</p>
            {trackingError && <p>{trackingError}</p>}
            {!history.length && <p>ยังไม่มีประวัติออเดอร์</p>}
            {history.map(h=>{
              const o=tracked[h.id];
              if(!o||o.error||o.missing)return <section key={h.id} className="panel"><b>{h.number}</b><p>{!o?'กำลังโหลด…':o.error?'เชื่อมต่อไม่ได้ กำลังลองใหม่':'ไม่พบออเดอร์หรือรหัสติดตามไม่ถูกต้อง'}</p></section>;
              const delivery=o.fulfillment_type==='delivery'||['delivering','out_for_delivery'].includes(o.order_status);
              const cancelled=o.order_status==='cancelled'||!!o.cancelled_at;
              const waiting=!cancelled && o.waiting_for_acceptance===true;
              const steps=[...(o.acceptance_required?[['waiting','รอตอบรับออเดอร์']]:[]),['pending',o.acceptance_required?'ร้านตอบรับออเดอร์แล้ว':'ร้านได้รับออเดอร์แล้ว'],['preparing','กำลังทำอาหาร'],['ready',delivery?'อาหารพร้อมส่ง':'อาหารพร้อมรับ'],...(delivery?[['delivering','กำลังนำส่ง'],['arrived','อาหารมาถึงแล้ว']]:[]),['completed','ออเดอร์เสร็จสิ้น']];
              const status=cancelled?'cancelled':waiting?'waiting':o.order_status==='out_for_delivery'?'delivering':o.order_status;
              const index=steps.findIndex(x=>x[0]===status);
              const payLabels={pending:'รอชำระเงิน',reviewing:'รอตรวจสอบสลิป',paid:'ชำระเงินเรียบร้อยแล้ว',rejected:'สลิปไม่ผ่านการตรวจสอบ'};
              return <section key={h.id} className="panel" style={{marginTop:16}}>
                <h3>{o.order_number}</h3><h2>{money(o.total_amount)} บาท</h2>
                <p>{({cash:'ชำระเงินสดที่ร้าน',promptpay:'ชำระผ่าน QR Code',cod:o.cod_payment_type==='promptpay'?'ชำระผ่าน QR Code ปลายทาง':'ชำระเงินสดปลายทาง'})[o.payment_method]||o.payment_method} · {status==='cancelled' && o.payment_status==='pending'?'ไม่ต้องชำระเงิน':waiting?'ยังไม่เปิดรับชำระเงิน':payLabels[o.payment_status]||o.payment_status}</p>
                {waiting && <p>กรุณารอร้านตอบรับก่อนชำระเงิน</p>}
                {!waiting && o.accepted_at && status==='pending' && o.payment_method==='promptpay' && o.payment_status==='pending' && <button disabled={codBusy||!!pending||!!payment} onClick={()=>payAccepted(h)}>ชำระผ่าน QR Code</button>}
                {o.payment_method==='cod' && o.cod_payment_type==='promptpay' && (delivery?status==='arrived':status==='ready') && ['pending','rejected'].includes(o.payment_status) && <button disabled={codBusy||!!pending||!!payment} onClick={()=>payCod(h,o.payment_status==='rejected')}>{o.payment_status==='rejected'?'ส่งสลิปใหม่':'ชำระผ่าน QR Code ปลายทาง'}</button>}
                {cancelled && <div role="status" style={{padding:20,border:'2px solid #dc2626',borderRadius:12,textAlign:'center',background:'#fff5f5',color:'#991b1b'}}><h2>✕ ออเดอร์ถูกยกเลิก</h2><strong>{o.order_number}</strong>{o.cancelled_by==='shop' && <p>ร้านไม่สามารถรับออเดอร์ของคุณได้</p>}<p>เหตุผล: {o.cancellation_reason||'ไม่ระบุ'}</p>{o.payment_status==='pending' && <strong>ไม่ต้องชำระเงิน</strong>}</div>}
                {cancelled?null:index<0?<p>สถานะ: {status==='cancelled'?'ยกเลิกแล้ว':status}</p>:steps.map(([key,label],i)=>{
                  const done=i<index||status==='completed';
                  return <p key={key} style={{color:done?'#15803d':i===index?'#b50920':'#6b7280',fontWeight:i===index||done?700:400}}>{done?'✓':i===index?'●':'○'} {label}</p>;
                })}
              </section>;
            })}
          </section>
        ) : page === 'shop' ? (
          <>
            {pending && !payment && <section className="panel"><p>มีคำขอเดิมที่ยังไม่ได้รับการยืนยัน กรุณาส่งซ้ำก่อนสั่งใหม่</p><button disabled={submitting} onClick={submitOrder}>ส่งคำขอเดิมอีกครั้ง</button></section>}
            <fieldset disabled={!!pending || submitting || !!payment} style={{border:0,padding:0,minWidth:0}}>
            <h2>ถ้วยที่ {bowls.length+1} · เลือกวัตถุดิบ</h2>
            <p className="sub">
              เลือกจำนวนกรัม แล้วกดเพิ่มใส่ตะกร้า
            </p>

            {Object.entries(groupedIngredients).map(
              ([category, items]) => (
                <section key={category}>
                  <h3>{category}</h3>

                  <div className="grid">
                    {items.map(item => {
                      const soldOut =
                        item.is_available === false;

                      const weight = getWeight(item);

                      const price =
                        weight *
                        Number(item.price_per_100g) /
                        100;

                      return (
                        <article
                          key={item.id}
                          style={{
                            opacity: soldOut ? 0.65 : 1
                          }}
                        >
                          <div className="emoji">
                            {soldOut ? '🚫' : '🥢'}
                          </div>

                          <div>
                            <strong>{item.name}</strong>

                            <small>
                              {item.price_per_100g}
                              {' บาท / 100 กรัม'}
                            </small>

                            {soldOut ? (
                              <>
                                <p
                                  style={{
                                    color: '#c62828',
                                    fontWeight: 'bold'
                                  }}
                                >
                                  สินค้าหมด
                                </p>

                                <button disabled>
                                  สินค้าหมด
                                </button>
                              </>
                            ) : (
                              <>
                                <label>
                                  เลือกน้ำหนัก
                                  <select
                                    value={weight}
                                    onChange={event =>
                                      setSelectedWeights(
                                        current => ({
                                          ...current,
                                          [item.id]:
                                            Number(
                                              event.target.value
                                            )
                                        })
                                      )
                                    }
                                  >
                                    {(
                                      item.weight_options || []
                                    ).map(w => (
                                      <option
                                        key={w}
                                        value={w}
                                      >
                                        {w} กรัม
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <p>
                                  ราคา{' '}
                                  <b>
                                    {price.toFixed(2)}
                                    {' บาท'}
                                  </b>
                                </p>

                                <button
                                  className="primary"
                                  disabled={
                                    !(item.weight_options || [])
                                      .length
                                  }
                                  onClick={() =>
                                    addToCart(item)
                                  }
                                >
                                  + เพิ่มใส่ตะกร้า
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )
            )}

            <section className="panel">
              <h2>② เลือกแบบน้ำหรือแห้ง</h2>
              <div className="choices"><button className={method==='soup'?'active':''} onClick={()=>setMethod('soup')}>แบบน้ำ</button><button className={method==='dry'?'active':''} onClick={()=>setMethod('dry')}>แบบแห้ง</button></div>

              <div className="choices">
                {method === 'soup' && soups.map(item => (
                  <button
                    key={item.id}
                    className={
                      soup === item.name ? 'active' : ''
                    }
                    onClick={() => setSoup(item.name)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              {spiceEnabled && <><h2>③ เลือกระดับความเผ็ด</h2><div className="choices">{allowedSpices.map(level=><button key={level} className={effectiveSpice===level?'active':''} onClick={()=>setSpice(level)}>{level}</button>)}</div></>}
              {invalidSpice&&<p className="sub">ตรวจสอบน้ำซุปและความเผ็ดของทุกถ้วยก่อนสั่งอาหาร หากเมนูเปลี่ยน กรุณาลบถ้วยเดิมแล้วเลือกใหม่</p>}
            </section>

            {sauceEnabled && (
              <section className="panel">
                <h2>④ เลือกน้ำจิ้ม</h2>
                <p className="sub">เลือกได้สูงสุด {maxCups} ถ้วย · ถ้วยละไม่เกิน {sauceSettings.cup_capacity} ช้อน</p>
                {sauceError && <p style={{ color: '#c62828' }}>{sauceError}</p>}
                <button className="primary" disabled={cupOffset+sauceCups.length>=maxCups} onClick={()=>setSauceCups(old=>[...old,{key:crypto.randomUUID(),type:'',ingredients:[]}])}>＋ เพิ่มถ้วยน้ำจิ้ม</button>
                {sauceCups.map((c,i)=><div className="panel" key={c.key}>
                  <div className="line"><b>น้ำจิ้มถ้วยที่ {cupOffset+i+1}</b><b>{money(priceSauceCup(c,i))} บาท</b><button onClick={()=>setSauceCups(old=>old.filter(x=>x.key!==c.key))}>ลบ</button></div>
                  <div className="choices">{[['recipe','สูตรร้าน'],['custom','ผสมเอง']].map(([type,label])=><button key={type} className={c.type===type?'active':''} onClick={()=>{if(c.type!==type)updateCup(c.key,{type,recipe_id:null,name:'',ingredients:[]});}}>{label}</button>)}</div>
                  {c.type==='recipe' && sauceRecipes.map(item=><label key={item.id} style={{display:'block',opacity:item.is_available===false?.6:1}}><input type="radio" name={'recipe-'+c.key} disabled={item.is_available===false} checked={String(c.recipe_id)===String(item.id)} onChange={()=>updateCup(c.key,{recipe_id:item.id,name:item.name})}/> {item.name} {item.is_available===false?' · สินค้าหมด':''} {item.description||''}</label>)}
                  {c.type==='custom' && <>{sauceIngredients.map(item=>{const count=Number(c.ingredients?.find(p=>String(p.ingredient_id)===String(item.id))?.spoons||0);return <div className="line" key={item.id}><span>{item.name} {item.is_available===false?' · สินค้าหมด':''}</span><div><button disabled={!count} onClick={()=>changeSpoons(c,item,-1)}>−</button> {count} ช้อน <button disabled={item.is_available===false||count>=Number(item.max_spoons)} onClick={()=>changeSpoons(c,item,1)}>+</button></div></div>;})}<p>รวม {(c.ingredients||[]).reduce((n,p)=>n+Number(p.spoons),0)} / {sauceSettings.cup_capacity} ช้อน</p></>}
                  {!validCup(c)&&<p className="sub">กรุณาเลือกน้ำจิ้มให้ครบ หรือลบถ้วยนี้</p>}
                </div>)}
                <p className="sub">ไม่รับน้ำจิ้ม สามารถข้ามได้ · ราคาจริงคำนวณใหม่เมื่อยืนยันออเดอร์</p>
              </section>
            )}

            <section className="panel cart">
              <h2>
                🛒 ตะกร้าสินค้า ({cartCount})
              </h2>

              {!cart.length ? (
                <p>ยังไม่มีสินค้าในตะกร้า</p>
              ) : (
                <>
                  {cart.map(item => (
                    <div
                      className="line"
                      key={item.cartId}
                    >
                      <span>
                        {item.name}
                        {' · '}
                        {item.grams} กรัม
                      </span>

                      <b>
                        {item.price.toFixed(2)}
                        {' บาท'}
                      </b>

                      <button
                        onClick={() =>
                          removeFromCart(item.cartId)
                        }
                      >
                        ลบ
                      </button>
                    </div>
                  ))}

                  <button onClick={clearCart}>
                    ล้างตะกร้า
                  </button>
                </>
              )}

              {sauceCups.map((cup, index) => (
                <div className="line" key={cup.key}>
                  <span>น้ำจิ้มถ้วยที่ {index + 1}: {sauceCupLabel(cup)}</span>
                  <b>{money(priceSauceCup(cup, index))} บาท</b>
                  <button onClick={() => setSauceCups(old => old.filter(x => x.key !== cup.key))}>ลบ</button>
                </div>
              ))}
              {sauceEnabled && <div className="line"><span>รวมน้ำจิ้ม</span><b>{money(sauceTotal)} บาท</b></div>}
              <div className="line">
                <span>น้ำซุป</span>
                <b>{method==='dry'?'แบบแห้ง':soup || '-'}</b>
              </div>

              <div className="line">
                <span>ความเผ็ด</span>
                <b>{effectiveSpice||"ไม่ต้องเลือก"}</b>
              </div>

              <div className="line">
                <strong>น้ำหนักรวม</strong>
                <strong>{savedWeight+totalWeight} กรัม</strong>
              </div>

              <div className="line">
                <strong>ยอดชำระทั้งหมด (ประมาณการ)</strong>
                <strong>
                  {money(grandTotal)} บาท
                </strong>
              </div>

              {bowls.map((b,i)=><div className="line" key={b.key}><span>ถ้วยที่ {i+1} · {b.weight} กรัม · {money(bowlPrices[i])} บาท</span><button onClick={()=>setBowls(old=>old.filter(x=>x.key!==b.key))}>ลบถ้วย</button></div>)}
              <button disabled={invalidSpice || invalidSauces || !cart.length || cart.length>40 || bowls.length>=9 || (method==='soup'&&!soup)} onClick={addBowl}>+ เพิ่มถ้วยถัดไป</button>
              <h3>เลือกรับอาหาร</h3><div className="choices">{[['pickup','รับที่ร้าน'],['delivery','จัดส่ง']].map(([v,l])=><button key={v} className={fulfillment===v?'active':''} onClick={()=>{setFulfillment(v);if(v==='delivery'&&paymentMethod==='cash')setPaymentMethod('cod');}}>{l}</button>)}</div>
               <h3>เลือกวิธีชำระเงิน</h3>
              <div className="choices"><button disabled={fulfillment==='delivery'} className={paymentMethod==='cash'?'active':''} onClick={()=>setPaymentMethod('cash')}>ชำระเงินสดที่ร้าน</button><button className={paymentMethod==='promptpay'?'active':''} onClick={()=>setPaymentMethod('promptpay')}>ชำระผ่าน QR Code</button><button className={paymentMethod==='cod'?'active':''} onClick={()=>setPaymentMethod('cod')}>ชำระเงินปลายทาง</button></div>
               {paymentMethod==='cod'&&<div className="choices">{[['cash','ชำระเงินสดปลายทาง'],['promptpay','ชำระผ่าน QR Code ปลายทาง']].map(([v,l])=><button key={v} className={codType===v?'active':''} onClick={()=>setCodType(v)}>{l}</button>)}</div>}
              <button
                className="primary"
                disabled={invalidSpice||invalidSauces||(!cart.length&&!bowls.length)||cart.length>40||(!cart.length&&sauceCups.length>0)||(cart.length>0&&method==='soup'&&!soup)||submitting||!!pending}
                onClick={submitOrder}
              >
                {submitting
                  ? 'กำลังส่งออเดอร์...'
                  : 'ยืนยันสั่งอาหาร'}
              </button>

              <p className="sub">
                ระบบทดสอบ ยังไม่เปิดรับเงินจริง
              </p>
            </section>
            </fieldset>
            {payment && <section className="panel" ref={paymentPanel} style={{scrollMarginTop:24,background:'#ffffff',border:'1px solid #dddddd',borderRadius:16,padding:18,color:'#222'}}>
              <h2 style={{color:'#b50920',fontSize:20,margin:'0 0 12px'}}>ชำระเงิน</h2>
              <p style={{color:'#666',fontSize:14}}>ออเดอร์ {payment.order_number}</p>
              <div style={{textAlign:'center',padding:'12px 0 20px',borderBottom:'1px solid #dddddd'}}>
                <div style={{color:'#666',fontWeight:600}}>ยอดชำระทั้งหมด</div>
                <h2 style={{color:'#b50920',fontSize:32,margin:'8px 0 0'}}>{money(payment.total_amount)} บาท</h2>
              </div>
              {payment.payment_status==='pending' ? <>
                <div style={{textAlign:'center',padding:'16px 0 8px'}}>
                  <h3 style={{margin:'0 0 12px'}}>ชำระผ่าน QR Code</h3>
                  <div style={{color:'#666',fontSize:13,marginBottom:10}}>ระบบทดสอบ: ยังไม่ต้องโอนเงินจริง</div>
                  {qr && <img src={qr} alt="PromptPay QR" style={{width:420,height:'auto',maxWidth:'100%',display:'block',margin:'auto',borderRadius:8,border:'1px solid #ddd',boxSizing:'border-box',background:'#fff'}}/>}
                  {!qr && <p>กำลังเตรียม QR Code หากไม่แสดง กรุณาตรวจสอบสถานะออเดอร์</p>}
                  {qr && <p style={{margin:'8px 0'}}><a style={{color:'#666',fontSize:13,textDecoration:'underline'}} href={qr} download={`PromptPay-${payment.order_number}.png`}>บันทึกรูป QR Code</a></p>}
                  <p style={{fontSize:14,color:'#666'}}>สแกนผ่านแอปธนาคารเพื่อชำระเงิน</p>
                </div>
                <button type="button" disabled={uploading||submitting} onClick={()=>slipInput.current?.click()} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:20,border:'1px dashed #c9c9c9',borderRadius:10,textAlign:'center',cursor:'pointer',position:'relative',marginBottom:12,width:'100%',background:'#fff',color:'#222',boxSizing:'border-box'}}>
                  <span aria-hidden="true" style={{fontSize:26}}>↑</span>
                  <strong>แนบสลิปการโอนเงิน</strong>
                  <span style={{fontSize:13,color:'#666'}}>JPG, PNG, WEBP ไม่เกิน 5 MB</span>
                  {slip && <span style={{overflowWrap:'anywhere'}}>{slip.name}</span>}
                </button>
                <input ref={slipInput} aria-label="แนบสลิปการโอนเงิน" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading||submitting} onChange={e=>{const file=e.target.files?.[0];if(file)setSlip(file);e.target.value='';}} style={{display:'none'}}/>
                <button className="primary" style={{width:'100%',minHeight:48,borderRadius:8}} disabled={!slip||!qr||uploading||submitting} onClick={uploadSlip}>{uploading?'กำลังส่งสลิป...':'ส่งหลักฐานการชำระเงิน'}</button>
                {<button disabled={uploading} onClick={()=>{setPayment(null);setSlip(null);setPage('tracking');}}>กลับไปติดตามออเดอร์</button>}
                {pending && <button disabled={uploading||submitting} onClick={submitOrder}>ตรวจสอบสถานะออเดอร์</button>}
              </> : <><p>{payment.payment_status==='reviewing'?'ส่งสลิปแล้ว รอร้านตรวจสอบ':payment.payment_status==='paid'?'ชำระเงินแล้ว':'สถานะ: '+payment.payment_status}</p><button onClick={()=>{setPayment(null);setSlip(null);setPage('tracking');}}>กลับไปติดตามออเดอร์</button></>}
            </section>}

          </>
        ) : (
          <>
            <h2>ระบบหลังร้าน</h2>

            {!session ? (
              <form
                className="panel login"
                onSubmit={login}
              >
                <label>
                  อีเมล
                  <input
                    type="email"
                    value={email}
                    onChange={event =>
                      setEmail(event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  รหัสผ่าน
                  <input
                    type="password"
                    value={password}
                    onChange={event =>
                      setPassword(event.target.value)
                    }
                    required
                  />
                </label>

                <button
                  className="primary"
                  type="submit"
                >
                  เข้าสู่ระบบ
                </button>
              </form>
            ) : checkingAdmin ? (
              <section className="panel">
                กำลังตรวจสอบสิทธิ์ผู้ดูแล...
              </section>
            ) : !isAdmin ? (
              <section className="panel">
                <h2>ไม่มีสิทธิ์จัดการร้าน</h2>

                <p>
                  กรุณาตรวจสอบสิทธิ์ในตาราง
                  admin_users
                </p>

                <button onClick={logout}>
                  ออกจากระบบ
                </button>
              </section>
            ) : (
              <section className="panel">
                <p>
                  ผู้ดูแล: {session.user.email}
                </p>

                <button onClick={logout}>
                  ออกจากระบบ
                </button>

                <div className="choices">
                  <button style={{background:adminTab==='orders'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}}
                    className={
                      adminTab === 'orders'
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      setAdminTab('orders')
                    }
                  >
                    ออเดอร์
                  </button>

                  <button style={{background:adminTab==='ingredients'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}}
                    className={
                      adminTab === 'ingredients'
                        ? 'active'
                        : ''
                    }
                    onClick={() => {
                      setAdminTab('ingredients');
                      loadMenu();
                    }}
                  >
                    จัดการวัตถุดิบ
                  </button>
                  {owner&&<><button style={{background:adminTab==='finance'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}} onClick={()=>setAdminTab('finance')}>การเงิน</button><button style={{background:adminTab==='inventory'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}} onClick={()=>setAdminTab('inventory')}>สต็อกเพิ่มเติม</button></>}
                  {owner&&[['catalog','สินค้าและหมวดหมู่'],['expenses','ค่าใช้จ่าย'],['recipes','สูตรผลิต']].map(([key,label])=><button key={key} style={{background:adminTab===key?'#650b10':'#a71920',color:'#fff',fontWeight:600}} onClick={()=>setAdminTab(key)}>{label}</button>)}
                  {owner&&<button style={{background:adminTab==='soups'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}} className={adminTab==='soups'?'active':''} onClick={()=>{setAdminTab('soups');loadMenu();}}>จัดการน้ำซุป</button>}
                  <button style={{background:adminTab==='sauces'?'#650b10':'#a71920',color:'#fff',borderColor:'#a71920',fontWeight:600}} className={adminTab === 'sauces' ? 'active' : ''}
                    onClick={() => { setAdminTab('sauces'); loadSauces(); }}>
                    จัดการน้ำจิ้ม
                  </button>
                </div>

                {owner && ['catalog','expenses','recipes'].includes(adminTab) ? <OwnerSetupPanel key={adminTab} db={db} mode={adminTab}/> : owner && adminTab === 'finance' ? <FinancePanel db={db}/> : owner && adminTab === 'inventory' ? <InventoryPanel db={db}/> : adminTab === 'orders' ? (
                  <>
                    <h2>รายการออเดอร์</h2>

                    <button
                      className="primary"
                      onClick={loadOrders}
                    >
                      โหลดออเดอร์
                    </button>

                    <label>ค้นหาประวัติ<input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="เลขออเดอร์"/></label>
                    <label>วันที่รับออเดอร์<input type="date" value={historyDate} onChange={e=>setHistoryDate(e.target.value)}/></label>
                    <h3>ออเดอร์ที่กำลังดำเนินการ ({activeOrders.length})</h3>
                    {!activeOrders.length && <p style={{textAlign:'center',padding:20}}>✓ ไม่มีออเดอร์ที่กำลังดำเนินการ</p>}
                    {[...activeOrders,...pastOrders].map((order,index) => {
                      const closed=closedOrder(order);
                      const color=({pending:'#b91c1c',preparing:'#cc802d',ready:'#367b40',delivering:'#2563eb',arrived:'#367b40'})[order.order_status]||'#666';
                      const awaitingAcceptance=order.acceptance_required===true && !order.accepted_at && order.order_status==='pending';
                      const statusLabel=({pending:awaitingAcceptance?'รอตอบรับออเดอร์':'ออเดอร์ใหม่',preparing:'กำลังทำอาหาร',ready:order.fulfillment_type==='delivery'?'อาหารพร้อมส่ง':'อาหารพร้อมรับ',delivering:'กำลังนำส่ง',arrived:'อาหารมาถึงแล้ว',completed:'เสร็จสิ้น',cancelled:'ยกเลิก'})[order.order_status]||order.order_status;
                      const body=<>
                        <details open={awaitingAcceptance || undefined} style={{margin:"12px 0",padding:12,border:"1px solid #d6bdb4",borderRadius:10,background:"#fff"}}>
                        <summary style={{cursor:"pointer",fontSize:18,fontWeight:800,padding:8}}>ดูรายละเอียดออเดอร์</summary>
                        <p>เวลาสั่ง: {new Date(order.created_at).toLocaleString("th-TH")}</p>
                        {canManage && <><p>ลูกค้า: {order.customer_name || "ไม่ระบุ"} · โทร: {order.customer_phone || "ไม่ระบุ"}</p>{order.fulfillment_type === "delivery" && <><p>ที่อยู่: {order.delivery_address || "ไม่ระบุ"}</p>{order.delivery_latitude != null && order.delivery_longitude != null && <p><a href={`https://www.google.com/maps?q=${encodeURIComponent(order.delivery_latitude+","+order.delivery_longitude)}`} target="_blank" rel="noopener noreferrer">เปิดพิกัด GPS</a></p>}<p>หมายเหตุจัดส่ง: {order.delivery_note || "-"}</p></>}</>}
                        {order.order_note && <p>หมายเหตุออเดอร์: {order.order_note}</p>}
                        <p>
                          {order.soup_name}
                          {' · '}
                          {order.spice_level}
                        </p>

                        <p>การรับอาหาร: {order.fulfillment_type==='delivery'?'จัดส่ง':'รับที่ร้าน'} {order.payment_method==='cod'?' · '+(order.cod_payment_type==='promptpay'?'ชำระผ่าน QR Code ปลายทาง':'ชำระเงินสดปลายทาง'):''}</p>
                        {(order.order_bowls||[]).slice().sort((a,b)=>a.bowl_number-b.bowl_number).map(b=><section className="panel" key={b.id}><b>ถ้วยที่ {b.bowl_number} · {b.cooking_method==='dry'?'แบบแห้ง':b.soup_name} · {b.spice_level}</b>{b.bowl_note && <p>หมายเหตุถ้วย: {b.bowl_note}</p>}<p>น้ำหนัก {b.total_weight ?? "-"} กรัม · {money(b.total_amount)} บาท</p>{(order.order_items||[]).filter(i=>i.bowl_id===b.id).map(i=><p key={i.id}>{i.ingredient_name} · {i.weight_grams} กรัม · {money(i.price)} บาท</p>)}{(order.order_sauces||[]).filter(c=>c.bowl_id===b.id).map(c=><p key={c.id}>น้ำจิ้ม {c.cup_number}: {c.sauce_name} {Array.isArray(c.ingredients)?c.ingredients.map(p=>`${p.name||p.ingredient_name||'ส่วนผสม'} ${p.spoons} ช้อน`).join(', '):''} · {money(c.price)} บาท</p>)}</section>)}
                        <h3>รายการสินค้า</h3>

                        {(order.order_items || []).filter(i=>!(order.order_bowls||[]).some(b=>b.id===i.bowl_id)).map(
                          item => (
                            <div
                              className="line"
                              key={item.id}
                            >
                              <span>
                                {item.ingredient_name}
                                {' · '}
                                {item.weight_grams}
                                {' กรัม'}
                              </span>

                              <b>
                                {Number(
                                  item.price
                                ).toFixed(2)}
                                {' บาท'}
                              </b>
                            </div>
                          )
                        )}

                        {(order.order_sauces || []).some(c=>!(order.order_bowls||[]).some(b=>b.id===c.bowl_id)) && <>
                          <h3>น้ำจิ้ม</h3>
                          {order.order_sauces.filter(c=>!(order.order_bowls||[]).some(b=>b.id===c.bowl_id)).map(cup => (
                            <div className="line" key={cup.id}>
                              <span>ถ้วยที่ {cup.cup_number}: {cup.sauce_name}
                                {cup.sauce_type === 'custom' && Array.isArray(cup.ingredients) &&
                                  ' · ' + cup.ingredients.map(part => `${part.name || part.ingredient_name || 'ส่วนผสม'} ${part.spoons} ช้อน`).join(', ')}
                              </span>
                              <b>{money(cup.price)} บาท</b>
                            </div>
                          ))}
                        </>}
                        <p>
                          น้ำหนักรวม:
                          {' '}
                          {order.total_weight}
                          {' กรัม'}
                        </p>

                        <p>วิธีชำระเงิน: {({cash:'ชำระเงินสดที่ร้าน',promptpay:'ชำระผ่าน QR Code',cod:order.cod_payment_type==='promptpay'?'ชำระผ่าน QR Code ปลายทาง':'ชำระเงินสดปลายทาง'})[order.payment_method] || order.payment_method || '-'}</p>
                        <p>การชำระเงิน: {({pending:'รอชำระเงิน',reviewing:'รอตรวจสอบสลิป',paid:'ชำระแล้ว',rejected:'ปฏิเสธสลิป'})[order.payment_status] || order.payment_status}</p>
                        <p>ยอดรวม: <strong>{money(order.total_amount)} บาท</strong></p>
                        <p>สถานะออเดอร์: {awaitingAcceptance ? "รอร้านตอบรับออเดอร์" : ({pending:'รอดำเนินการ',preparing:'กำลังทำอาหาร',ready:'อาหารพร้อมส่งมอบ',delivering:'กำลังนำส่ง',arrived:'อาหารมาถึงแล้ว',completed:'เสร็จสิ้น'})[order.order_status] || order.order_status}</p>
                        </details>
                        <div className="choices">
                          {canManage && awaitingAcceptance && <button disabled={orderBusy} onClick={()=>orderAction(order,'accept_customer_order')} style={{display:'block',width:'100%',flexBasis:'100%',minHeight:64,padding:'16px 20px',margin:'12px 0',background:'#15803d',color:'#fff',border:'2px solid #166534',borderRadius:12,fontSize:22,fontWeight:800,boxShadow:'0 3px 8px #0002',opacity:orderBusy?0.6:1}}>{orderBusy?'กำลังดำเนินการ…':'✓ ตอบรับออเดอร์'}</button>}
                          {canManage && awaitingAcceptance && <button disabled={orderBusy} style={{width:'100%',background:'#fff',color:'#b91c1c',border:'1px solid #b91c1c',padding:12}} onClick={()=>setRejectForm({id:order.id,reason:'สินค้าหมด',other:''})}>ปฏิเสธออเดอร์</button>}
                          {canManage && awaitingAcceptance && rejectForm?.id===order.id && <div style={{width:'100%',padding:12,border:'1px solid #b91c1c',borderRadius:8}}>
                            <strong>เลือกเหตุผลปฏิเสธ {order.order_number}</strong>
                            {['สินค้าหมด','ร้านปิดแล้ว','ออเดอร์เต็ม','อยู่นอกพื้นที่จัดส่ง','เหตุผลอื่น ๆ'].map(r=><label key={r} style={{display:'block',padding:8}}><input type="radio" name={'reject-'+order.id} checked={rejectForm.reason===r} disabled={orderBusy} onChange={()=>setRejectForm(f=>({...f,reason:r}))}/> {r}</label>)}
                            {rejectForm.reason==='เหตุผลอื่น ๆ' && <textarea maxLength={300} value={rejectForm.other} disabled={orderBusy} placeholder="ระบุเหตุผล" onChange={e=>setRejectForm(f=>({...f,other:e.target.value}))}/>}
                            <p>ลูกค้าจะเห็นเหตุผลนี้และไม่ต้องชำระเงิน</p>
                            <button disabled={orderBusy || (rejectForm.reason==='เหตุผลอื่น ๆ' && !rejectForm.other.trim())} style={{background:'#b91c1c',color:'#fff'}} onClick={()=>{if(window.confirm('ยืนยันปฏิเสธ '+order.order_number+'?')) orderAction(order,'reject_customer_order',rejectForm.reason==='เหตุผลอื่น ๆ'?rejectForm.other.trim():rejectForm.reason);}}>ยืนยันปฏิเสธ</button>
                            <button disabled={orderBusy} onClick={()=>setRejectForm(null)}>กลับ</button>
                          </div>}
                          {order.order_status==='cancelled' && order.cancelled_by==='shop' && <p>ร้านปฏิเสธ: {order.cancellation_reason||'ไม่ระบุ'}</p>}
                          {owner && ['promptpay','cod'].includes(order.payment_method) && order.slip_url && <button onClick={()=>openSlip(order)}>เปิดดูสลิป</button>}
                          {owner && order.payment_status === 'reviewing' && ((order.payment_method==='promptpay'&&order.order_status==='pending')||(order.payment_method==='cod'&&order.cod_payment_type==='promptpay'&&['ready','arrived'].includes(order.order_status))) && order.slip_url && <>
                            <button disabled={orderBusy} onClick={()=>orderAction(order,'review_order_payment',true)}>อนุมัติการชำระเงิน</button>
                            <button disabled={orderBusy} onClick={()=>orderAction(order,'review_order_payment',false)}>ปฏิเสธสลิป</button>
                          </>}
                          {!awaitingAcceptance && owner && order.payment_method === 'cash' && order.payment_status === 'pending' && order.order_status === 'pending' && <button disabled={orderBusy} onClick={()=>orderAction(order,'confirm_cash_payment')}>ยืนยันรับเงินสด</button>}
                          {!awaitingAcceptance && canManage && order.order_status === 'pending' && (order.payment_status === 'paid' || (order.payment_method === 'cod' && order.payment_status === 'pending')) && <button disabled={orderBusy} onClick={()=>orderAction(order,'start_paid_order')}>เริ่มทำอาหาร</button>}
                          {canManage && order.order_status==='preparing' && (order.payment_status==='paid'||(order.payment_method==='cod'&&order.payment_status==='pending')) && <button disabled={orderBusy} onClick={()=>orderAction(order,'mark_order_ready')}>ทำอาหารเสร็จแล้ว</button>}
                          {canManage && order.fulfillment_type==='delivery' && order.order_status==='ready' && (order.payment_status==='paid'||(order.payment_method==='cod'&&order.payment_status==='pending')) && <button disabled={orderBusy} onClick={()=>orderAction(order,'start_order_delivery')}>เริ่มจัดส่ง</button>}
                          {canManage && order.fulfillment_type==='delivery' && order.order_status==='delivering' && <button disabled={orderBusy} onClick={()=>orderAction(order,'mark_order_arrived')}>อาหารมาถึงแล้ว</button>}
                          {owner && order.payment_method==='cod' && (order.cod_payment_type||'cash')==='cash' && order.payment_status==='pending' && (order.fulfillment_type==='delivery'?order.order_status==='arrived':order.order_status==='ready') && <button disabled={orderBusy} onClick={()=>orderAction(order,'confirm_cod_payment')}>ยืนยันรับเงินปลายทาง</button>}
                          {canManage && order.payment_status==='paid' && (order.fulfillment_type==='delivery'?order.order_status==='arrived':order.order_status==='ready') && <button disabled={orderBusy} onClick={()=>orderAction(order,'complete_paid_order')}>ปิดออเดอร์</button>}
                        </div>
                      </>;
                      return <React.Fragment key={order.id}>
                        {index===activeOrders.length && <h3>ประวัติออเดอร์ที่เสร็จสิ้น ({pastOrders.length})</h3>}
                        {closed ? <details className="panel" style={{padding:12,marginBottom:8}}><summary style={{cursor:'pointer'}}><b>{order.order_status==='completed'?'✓':'×'} {order.order_number} · {money(order.total_amount)} บาท</b><small> {order.order_bowls?.length||1} ถ้วย · {statusLabel}</small></summary>{body}</details> : <article className="order" style={{border:`2px solid ${color}`,padding:12,marginBottom:16,display:'block'}}><div style={{background:color,color:'#fff',padding:14,borderRadius:8}}><div className="line"><strong style={{fontSize:22}}>{order.order_number}</strong><b>{statusLabel}</b></div><p>รับออเดอร์มาแล้ว {elapsed(order)} นาที</p><b>{money(order.total_amount)} บาท</b></div>{body}</article>}
                      </React.Fragment>;
                    })}
                    {!pastOrders.length && <p>ไม่มีประวัติออเดอร์ที่ตรงกับการค้นหา</p>}

                  </>
                ) : adminTab === 'soups' ? (owner?<>
                  <h2>จัดการน้ำซุป</h2><p>ฐานข้อมูลใช้ร่วมกับเว็บไซต์หลัก ยังไม่ควรบันทึกการตั้งค่าใหม่จนกว่าเว็บไซต์หลักรองรับ</p>
                  <button onClick={()=>setSoupForm({...blankSoup})}>+ เพิ่มน้ำซุป</button>
                  {allSoups.map(x=><div className="line" key={x.id}><span>{x.name} · {x.is_available?'เปิดขาย':'ปิดขาย'}</span><button onClick={()=>setSoupForm({...x})}>แก้ไข</button><button disabled={saving} onClick={()=>deleteSoup(x)}>ลบ</button></div>)}
                  <form className="panel" onSubmit={e=>saveSoup(e,false)}><h3>{soupForm.id?'แก้ไขน้ำซุป':'เพิ่มน้ำซุป'}</h3>
                  <label>ชื่อ<input required value={soupForm.name} onChange={e=>setSoupForm(o=>({...o,name:e.target.value}))}/></label>
                  <label>รายละเอียด<input value={soupForm.description||''} onChange={e=>setSoupForm(o=>({...o,description:e.target.value}))}/></label>
                  <label>ลำดับ<input type="number" step="1" required value={soupForm.sort_order} onChange={e=>setSoupForm(o=>({...o,sort_order:e.target.value}))}/></label>
                  <label><input type="checkbox" checked={soupForm.is_available} onChange={e=>setSoupForm(o=>({...o,is_available:e.target.checked}))}/> เปิดขาย</label>
                  {spiceFields(soupForm,setSoupForm)}<button className="primary" disabled={saving} type="submit">บันทึกน้ำซุป</button></form>
                  <form className="panel" onSubmit={e=>saveSoup(e,true)}><h3>ตั้งค่าแบบแห้ง</h3>{spiceFields(dryForm,setDryForm)}<button className="primary" disabled={saving} type="submit">บันทึกแบบแห้ง</button></form>
                </>:<p>ไม่มีสิทธิ์</p>) : adminTab === 'sauces' ? (
                  <>
                    <h2>จัดการน้ำจิ้ม</h2>
                    <button onClick={loadSauces}>รีเฟรชข้อมูลน้ำจิ้ม</button>
                    <form className="panel" onSubmit={saveSauceSettings}>
                      <h3>ตั้งค่าระบบน้ำจิ้ม</h3>
                      <label><input type="checkbox" checked={Boolean(sauceSettings.is_enabled)}
                        onChange={e => setSauceSettings(old => ({ ...old, is_enabled: e.target.checked }))} /> เปิดใช้งานน้ำจิ้ม</label>
                      {[
                        ['max_cups', 'จำนวนถ้วยสูงสุด', 1],
                        ['cup_capacity', 'ความจุถ้วย (ช้อน)', 0.5],
                        ['min_spoons', 'จำนวนช้อนขั้นต่ำ', 0.5],
                        ['max_ingredient_types', 'ชนิดส่วนผสมสูงสุด', 1],
                        ...(Array.isArray(sauceSettings.cup_prices) ? [] : [['custom_cup_price', 'ราคาเบสผสมเอง (บาท)', 0.01]])
                      ].map(([field, label, step]) => (
                        <label key={field} style={{display:'block',margin:'12px 0'}}>{label}
                          <input type="number" min="0" step={step} value={sauceSettings[field]}
                            onChange={e => setSauceSettings(old => ({ ...old, [field]: e.target.value, ...(field==='max_cups' && Array.isArray(old.cup_prices) ? {cup_prices:Array.from({length:Math.min(10,Math.max(0,Number(e.target.value)||0))},(_,i)=>old.cup_prices[i]??'')} : {}) }))} required />
                        </label>
                      ))}
                      <label style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={Array.isArray(sauceSettings.cup_prices)} onChange={e=>setSauceSettings(old=>({...old,cup_prices:e.target.checked?Array.from({length:Math.min(10,Math.max(1,Number(old.max_cups)||1))},()=>''):null}))}/> กำหนดราคารายถ้วย</label>
                      {Array.isArray(sauceSettings.cup_prices) ? <><p>ราคาเดียวกันทั้งสูตรร้านและผสมเอง · 0 บาท = ฟรี</p>{sauceSettings.cup_prices.map((p,i)=><label key={i} style={{display:'block',margin:'10px 0'}}>ถ้วยที่ {i+1} <input type="number" min="0" step="0.01" required value={p} onChange={e=>setSauceSettings(old=>({...old,cup_prices:old.cup_prices.map((v,j)=>j===i?e.target.value:v)}))}/> บาท</label>)}</> : <label>โหมดถ้วยแรกฟรี
                        <select value={sauceSettings.free_cup_mode} onChange={e => setSauceSettings(old => ({ ...old, free_cup_mode: e.target.value }))}>
                          <option value="none">ไม่ฟรี</option>
                          <option value="full_cup">ฟรีทั้งถ้วยแรก</option>
                          <option value="base_only">ฟรีเฉพาะราคาเบสผสมเองถ้วยแรก</option>
                          <option value="recipe_only">ฟรีถ้วยแรกเฉพาะสูตรร้าน</option>
                        </select>
                      </label>}
                      <button type="submit" className="primary" disabled={saving || !owner}>บันทึกการตั้งค่า</button>
                    </form>
                    <div className="choices">
                      <button className={sauceEditor === 'recipes' ? 'active' : ''} onClick={() => beginSauceEdit('recipes')}>สูตรน้ำจิ้มร้าน</button>
                      <button className={sauceEditor === 'ingredients' ? 'active' : ''} onClick={() => beginSauceEdit('ingredients')}>ส่วนผสมผสมเอง</button>
                    </div>
                    <form className="panel" onSubmit={saveSauceEntry}>
                      <h3>{sauceEditId ? 'แก้ไข' : 'เพิ่ม'}{sauceEditor === 'recipes' ? 'สูตรน้ำจิ้ม' : 'ส่วนผสมน้ำจิ้ม'}</h3>
                      <label>ชื่อ<input required value={sauceForm.name || ''} onChange={e => setSauceForm(old => ({ ...old, name: e.target.value }))} /></label>
                      <label>คำอธิบาย (ไม่บังคับ)<input value={sauceForm.description || ''} onChange={e => setSauceForm(old => ({ ...old, description: e.target.value }))} /></label>
                      <label>{sauceEditor === 'recipes' ? 'ราคาต่อถ้วย (บาท)' : 'ราคาต่อช้อน (บาท)'}
                        <input type="number" min="0" step="0.01" required
                          value={sauceEditor === 'recipes' ? sauceForm.price : sauceForm.price_per_spoon}
                          onChange={e => setSauceForm(old => ({ ...old, [sauceEditor === 'recipes' ? 'price' : 'price_per_spoon']: e.target.value }))} />
                      </label>
                      {sauceEditor === 'ingredients' && <label>จำนวนช้อนสูงสุดต่อส่วนผสม
                        <input type="number" min="0" step="0.5" required value={sauceForm.max_spoons}
                          onChange={e => setSauceForm(old => ({ ...old, max_spoons: e.target.value }))} />
                      </label>}
                      <label>ลำดับการแสดง<input type="number" step="1" value={sauceForm.sort_order ?? 0}
                        onChange={e => setSauceForm(old => ({ ...old, sort_order: e.target.value }))} /></label>
                      <label><input type="checkbox" checked={sauceForm.is_available !== false}
                        onChange={e => setSauceForm(old => ({ ...old, is_available: e.target.checked }))} /> เปิดขาย</label>
                      <button type="submit" className="primary" disabled={saving}>บันทึก</button>
                      {sauceEditId && <button type="button" onClick={() => beginSauceEdit(sauceEditor)}>ยกเลิกการแก้ไข</button>}
                    </form>
                    {(sauceEditor === 'recipes' ? sauceRecipes : sauceIngredients).map(item => (
                      <article className="order" key={item.id}>
                        <b>{item.name}</b>
                        <p>{item.description || 'ไม่มีคำอธิบาย'} · {money(sauceEditor === 'recipes' ? item.price : item.price_per_spoon)} บาท{ sauceEditor === 'ingredients' ? '/ช้อน' : '/ถ้วย' }</p>
                        <p>{item.is_available === false ? 'ปิดขาย' : 'เปิดขาย'}</p>
                        <button onClick={() => beginSauceEdit(sauceEditor, item)}>แก้ไข</button>
                        <button disabled={saving} onClick={() => toggleSauceEntry(sauceEditor, item)}>{item.is_available === false ? 'เปิดขาย' : 'ปิดขาย'}</button>
                      </article>
                    ))}
                  </>
                ) : (
                  <>
                    <h2>จัดการวัตถุดิบ</h2>

                    <p>
                      ปิดขาย = หน้าร้านแสดง
                      "สินค้าหมด"
                    </p>

                    <button onClick={newIngredient}>
                      + เพิ่มวัตถุดิบใหม่
                    </button>

                    <form
                      className="panel"
                      onSubmit={saveIngredient}
                    >
                      <h3>
                        {editingId
                          ? 'แก้ไขวัตถุดิบ'
                          : 'เพิ่มวัตถุดิบใหม่'}
                      </h3>

                      <label>
                        ชื่อวัตถุดิบ
                        <input
                          value={itemForm.name}
                          onChange={event =>
                            changeItem(
                              'name',
                              event.target.value
                            )
                          }
                          required
                        />
                      </label>

                      <label>
                        หมวดหมู่
                        <input
                          value={itemForm.category}
                          onChange={event =>
                            changeItem(
                              'category',
                              event.target.value
                            )
                          }
                          required
                        />
                      </label>

                      <label>
                        ราคาต่อ 100 กรัม
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={
                            itemForm.price_per_100g
                          }
                          onChange={event =>
                            changeItem(
                              'price_per_100g',
                              event.target.value
                            )
                          }
                          required
                        />
                      </label>

                      <label>
                        ตัวเลือกน้ำหนัก (กรัม)
                        <input
                          value={
                            itemForm.weight_options
                          }
                          onChange={event =>
                            changeItem(
                              'weight_options',
                              event.target.value
                            )
                          }
                          placeholder="50,100,150,200"
                          required
                        />
                      </label>

                      <label>
                        <input
                          type="checkbox"
                          checked={
                            itemForm.is_available
                          }
                          onChange={event =>
                            changeItem(
                              'is_available',
                              event.target.checked
                            )
                          }
                        />
                        เปิดขายสินค้า
                      </label>

                      <button
                        className="primary"
                        type="submit"
                        disabled={saving}
                      >
                        {saving
                          ? 'กำลังบันทึก...'
                          : 'บันทึกข้อมูล'}
                      </button>

                      {editingId && (
                        <button
                          type="button"
                          onClick={newIngredient}
                        >
                          ยกเลิกการแก้ไข
                        </button>
                      )}
                    </form>

                    <h3>วัตถุดิบทั้งหมด</h3>

                    {ingredients.map(item => (
                      <article
                        className="order"
                        key={item.id}
                      >
                        <b>{item.name}</b>

                        <p>
                          {item.category}
                          {' · '}
                          {item.price_per_100g}
                          {' บาท / 100 กรัม'}
                        </p>

                        <p>
                          น้ำหนัก:
                          {' '}
                          {(
                            item.weight_options || []
                          ).join(', ')}
                          {' กรัม'}
                        </p>

                        <p
                          style={{
                            color:
                              item.is_available === false
                                ? '#c62828'
                                : 'inherit'
                          }}
                        >
                          {item.is_available === false
                            ? 'สินค้าหมด'
                            : 'เปิดขาย'}
                        </p>

                        <button
                          onClick={() =>
                            editIngredient(item)
                          }
                        >
                          แก้ไข
                        </button>

                        <button
                          disabled={saving}
                          onClick={() =>
                            toggleIngredient(item)
                          }
                        >
                          {item.is_available === false
                            ? 'เปิดขายอีกครั้ง'
                            : 'ปิดขาย / สินค้าหมด'}
                        </button>
                      </article>
                    ))}
                  </>
                )}
              </section>
            )}
          </>
        )}

        {rejectSuccess && page==='admin' && <div role="status" style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',width:'min(90vw,480px)',boxSizing:'border-box',zIndex:9999,background:'#b91c1c',color:'#fff',padding:20,borderRadius:12,textAlign:'center',boxShadow:'0 4px 20px #0004'}}><strong style={{fontSize:22}}>✓ ยกเลิกออเดอร์สำเร็จ</strong><p>{rejectSuccess.number}</p><p>เหตุผล: {rejectSuccess.reason}</p><button style={{background:'#fff',color:'#991b1b'}} onClick={()=>setRejectSuccess(null)}>ปิด</button></div>}
        {notice && (
          <div
            className="notice"
            onClick={() => setNotice('')}
          >
            {notice} ✕
          </div>
        )}
      </main>

      <footer>
        หม่าล่าทั่ง · Mala Tang
      </footer>
    </>
  );
}

createRoot(
  document.getElementById('root')
).render(<App />);

function FinancePanel({db}) {
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'});
 const [start,S]=useState(today),[end,E]=useState(today),[summary,U]=useState(null),[rows,R]=useState([]),[orders,O]=useState([]),[expenses,EX]=useState([]),[cats,C]=useState([]),[error,X]=useState(''),[busy,B]=useState(false),[view,V]=useState('dashboard'),[uid,ID]=useState(''),[target,T]=useState('0');
 const modes=[['summary','สรุป'],['chart','กราฟกำไร–ขาดทุน'],['calendar','ปฏิทิน'],['ledger','รายรับ–รายจ่าย'],['product','กำไรรายสินค้า'],['expense','แยกค่าใช้จ่าย'],['target','เป้าหมาย / จุดคุ้มทุน'],['orders','กำไรรายออเดอร์'],['loss','แจ้งเตือนขาดทุน'],['dashboard','แดชบอร์ดผู้บริหาร']];
 useEffect(()=>{let alive=true;db.auth.getUser().then(({data})=>{if(!alive||!data?.user)return;const id=data.user.id;ID(id);try{const saved=localStorage.getItem('finance-view-'+id);if(modes.some(m=>m[0]===saved))V(saved);}catch{}});return()=>{alive=false;};},[]);
 function change(v){V(v);try{if(uid)localStorage.setItem('finance-view-'+uid,v);}catch{}}
 async function load(){if(start>end){X('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');return;}B(true);X('');U(null);R([]);O([]);EX([]);C([]);try{const args={p_start:start,p_end:end};const results=await Promise.all(['shop_finance_summary','shop_finance_daily','shop_order_profit'].map(n=>db.rpc(n,args)));for(const r of results)if(r.error)throw r.error;U(results[0].data);R(results[1].data||[]);O(results[2].data||[]);const extra=await Promise.all([db.from('shop_expenses').select('*').gte('expense_date',start).lte('expense_date',end).limit(1000),db.from('expense_categories').select('*').limit(1000)]);if(extra.some(r=>r.error))X('โหลดรายละเอียดค่าใช้จ่ายไม่สำเร็จ');else{EX(extra[0].data||[]);C(extra[1].data||[]);if(extra[0].data.length>=1000)X('รายละเอียดค่าใช้จ่ายอาจไม่ครบ (จำกัด 1,000 รายการ)');}}catch(e){X(e.message);}finally{B(false);}}
 const money=v=>v==null?'ไม่ทราบ':Number(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})+' บาท';
 const color=v=>v==null?'#b45309':Number(v)<0?'#dc2626':'#15803d';
 const card={padding:14,border:'1px solid #ddd',borderRadius:10};const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10};
 const daily=(items=rows)=><div style={{overflowX:'auto'}}><table style={{width:'100%'}}><thead><tr><th>วันที่</th><th>ยอดขาย</th><th>กำไรสุทธิ</th></tr></thead><tbody>{items.map(r=><tr key={r.report_date}><td>{r.report_date}</td><td>{money(r.sales)}</td><td style={{color:color(r.net_profit)}}>{money(r.net_profit)}</td></tr>)}</tbody></table></div>;
 const orderTable=(items=orders)=><div style={{overflowX:'auto'}}><table style={{width:'100%'}}><thead><tr><th>ออเดอร์</th><th>ยอดขาย</th><th>กำไรขั้นต้น</th></tr></thead><tbody>{items.map(r=><tr key={r.order_id}><td>{r.order_number}</td><td>{money(r.revenue)}</td><td style={{color:color(r.gross_profit)}}>{money(r.gross_profit)}</td></tr>)}</tbody></table></div>;
 const max=Math.max(1,...rows.map(r=>Math.abs(Number(r.net_profit)||0)));
 const totals=Object.entries(expenses.reduce((a,r)=>{const n=cats.find(c=>c.id===r.category_id)?.name||'ไม่ระบุ';a[n]=(a[n]||0)+Number(r.amount);return a;},{}));
 const overview=summary&&<div style={grid}>{[['ยอดขาย',summary.sales],['ต้นทุนที่บันทึก',summary.recorded_cost],['ค่าใช้จ่าย',summary.expenses],['กำไรสุทธิ',summary.net_profit]].map(([n,v])=><div key={n} style={card}>{n}<h3 style={{color:n==='กำไรสุทธิ'?color(v):undefined}}>{money(v)}</h3></div>)}</div>;
 return <section><h2>รายงานการเงิน</h2><div style={{display:'flex',flexWrap:'wrap',gap:8}}><label>จาก <input type="date" value={start} onChange={e=>S(e.target.value)}/></label><label>ถึง <input type="date" value={end} onChange={e=>E(e.target.value)}/></label><button disabled={busy} onClick={load} style={{background:'#941c24',color:'white'}}>โหลดรายงาน</button></div><label>รูปแบบรายงาน <select value={view} onChange={e=>change(e.target.value)}>{modes.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><p role="alert">{error}</p>{summary&&<><p>จำนวน {summary.orders} ออเดอร์ · ต้นทุนไม่ครบ {summary.incomplete_cost_orders} ออเดอร์</p>{['summary','dashboard'].includes(view)&&overview}{view==='dashboard'&&<><h3>รายวัน</h3>{daily()}<h3>รายออเดอร์</h3>{orderTable()}</>}{view==='chart'&&<div>{rows.map(r=><div key={r.report_date} style={card}>{r.report_date} · {money(r.net_profit)}<div style={{height:12,width:`${Math.abs(Number(r.net_profit)||0)/max*100}%`,background:color(r.net_profit)}}/></div>)}</div>}{view==='calendar'&&<div style={grid}>{rows.map(r=><div key={r.report_date} style={card}><strong>{r.report_date}</strong><p>ยอดขาย {money(r.sales)}</p><p style={{color:color(r.net_profit)}}>สุทธิ {money(r.net_profit)}</p></div>)}</div>}{view==='ledger'&&<>{daily()}<h3>รายการค่าใช้จ่าย</h3>{expenses.map(r=><p key={r.id}>{r.expense_date} · {cats.find(c=>c.id===r.category_id)?.name||'ไม่ระบุ'} · {money(r.amount)} · {r.note}</p>)}</>}{view==='product'&&<p>ยังไม่รองรับกำไรแยกรายสินค้า: ต้องเพิ่มข้อมูลต้นทุนรายรายการในฐานข้อมูลก่อน ไม่ใช้กำไรรายออเดอร์แทน</p>}{view==='expense'&&<>{totals.map(([n,v])=><div key={n} style={card}>{n} · {money(v)}</div>)}{!totals.length&&<p>ไม่มีรายละเอียดค่าใช้จ่าย</p>}</>}{view==='target'&&<>{overview}<label>เป้าหมายกำไรสุทธิ (บาท)<input type="number" min="0" value={target} onChange={e=>T(e.target.value)}/></label><p>กำไรที่ยังขาดจากเป้าหมาย: {summary.net_profit==null?'ต้นทุนไม่ครบ':money(Math.max(0,Number(target)-Number(summary.net_profit)))}</p><p>จุดคุ้มทุนยอดขายยังคำนวณไม่ได้จนกว่าจะแยกต้นทุนคงที่และผันแปร</p></>}{view==='orders'&&orderTable()}{view==='loss'&&<><h3>วันที่ขาดทุน</h3>{daily(rows.filter(r=>r.net_profit!=null&&Number(r.net_profit)<0))}<h3>ออเดอร์ขาดทุนขั้นต้น</h3>{orderTable(orders.filter(r=>r.gross_profit!=null&&Number(r.gross_profit)<0))}<p>รายการต้นทุนไม่ครบไม่ถูกนับเป็นกำไรหรือขาดทุน</p></>}</>}</section>;
}
function InventoryPanel({db}) {
 const [rows,R]=useState([]),[units,U]=useState([]),[conversions,C]=useState([]),[id,I]=useState(''),[unit,V]=useState(''),[qty,Q]=useState(''),[cost,K]=useState(''),[kind,T]=useState('stock_in'),[note,N]=useState(''),[msg,M]=useState(''),[busy,B]=useState(false);
 async function load(){try{const rs=await Promise.all(['inventory_resources','inventory_units','inventory_unit_conversions'].map(t=>db.from(t).select('*')));for(const r of rs)if(r.error)throw r.error;R(rs[0].data||[]);U(rs[1].data||[]);C(rs[2].data||[]);}catch(e){M(e.message);}}
 useEffect(()=>{load();},[]);
 const [newName,NN]=useState(''),[factor,F]=useState(''),[existing,EX]=useState(''),[unitOpen,SO]=useState(false);
 const [view,SV]=useState('cards'),[search,SS]=useState(''),[creating,SC]=useState(false),[resourceName,SR]=useState(''),[resourceType,ST]=useState('other'),[baseUnit,SB]=useState(''),[customUnit,SU]=useState('');
 async function createResource(e){e.preventDefault();if(busy)return;B(true);M('');try{let target=units.find(u=>u.id===baseUnit);if(!target){const name=customUnit.trim();if(!name)throw new Error('กรุณากำหนดหน่วย');target=units.find(u=>u.name===name);if(!target){const res=await db.from('inventory_units').insert({name,dimension:'custom'}).select().single();if(res.error)throw res.error;target=res.data;}}if(!target.active)throw new Error('หน่วยถูกปิดใช้งาน');const res=await db.rpc('create_inventory_resource',{p_name:resourceName.trim(),p_type:resourceType,p_base_unit_id:target.id});if(res.error)throw res.error;await load();I(res.data);V(target.id);SR('');SC(false);M('เพิ่มรายการสำเร็จ');}catch(e){M(e.message);}finally{B(false);}}
 const visible=rows.filter(r=>r.name.toLowerCase().includes(search.toLowerCase()));
 const low=r=>r.alert_enabled&&r.stock_quantity!=null&&Number(r.stock_quantity)<=Number(r.low_stock_quantity);
 const amount=r=>{const uid=r.display_unit_id||r.base_unit_id;const factor=conversions.find(c=>c.resource_id===r.id&&c.unit_id===uid)?.base_quantity||1;return r.stock_quantity==null?'ยังไม่กำหนด':`${Number(Number(r.stock_quantity)/Number(factor)).toLocaleString('th-TH',{maximumFractionDigits:8})} ${units.find(u=>u.id===uid)?.name||''}`;};
 const pick=r=>{I(r.id);V('');EX('');NN('');F('');};
 const selected=rows.find(r=>r.id===id);
 const baseName=units.find(u=>u.id===selected?.base_unit_id)?.name||'';
 async function addUnit(e){e.preventDefault();if(busy||!selected||!Number.isFinite(Number(factor))||Number(factor)<=0)return;B(true);M('');try{let target=units.find(u=>u.id===existing);if(!target){const name=newName.trim();if(!name)throw new Error('กรอกชื่อหน่วย');target=units.find(u=>u.name===name);if(!target){const result=await db.from('inventory_units').insert({name,dimension:'custom'}).select().single();if(result.error)throw result.error;target=result.data;}}if(!target.active)throw new Error('หน่วยนี้ถูกปิดใช้งาน');if(conversions.some(c=>c.resource_id===id&&c.unit_id===target.id))throw new Error('มีหน่วยนี้แล้ว');const {error}=await db.from('inventory_unit_conversions').insert({resource_id:id,unit_id:target.id,base_quantity:Number(factor)});if(error)throw error;await load();V(target.id);NN('');EX('');F('');M('เพิ่มหน่วยสำเร็จ');}catch(e){M(e.message);}finally{B(false);}}
 const choices=conversions.filter(c=>c.resource_id===id&&units.some(u=>u.id===c.unit_id&&u.active));
 const standard={'กรัม':1,'ขีด':100,'กิโลกรัม':1000,'มิลลิลิตร':1,'ซีซี':1,'ลิตร':1000};
 const base=units.find(u=>u.id===selected?.base_unit_id);
 const autoUnits=units.filter(u=>u.active&&base&&['mass','volume'].includes(base.dimension)&&u.dimension===base.dimension&&standard[u.name]&&standard[base.name]&&!choices.some(c=>c.unit_id===u.id));
 async function addStandard(u){if(busy||!selected)return;B(true);M('');try{const {error}=await db.from('inventory_unit_conversions').insert({resource_id:id,unit_id:u.id,base_quantity:standard[u.name]/standard[base.name]});if(error)throw error;await load();V(u.id);M('เพิ่มหน่วยสำเร็จ');}catch(e){M(e.message);}finally{B(false);}}
 const preview=Number(qty)*Number(choices.find(c=>c.unit_id===unit)?.base_quantity||0);
 const fieldStyle={padding:10,border:'1px solid #d8c8c0',borderRadius:8,width:'100%',boxSizing:'border-box'};
 async function save(e){e.preventDefault();if(busy||!id||!unit||!qty||!Number.isFinite(Number(qty))||Number(qty)===0||(kind!=='adjustment'&&Number(qty)<0)||(kind==='stock_in'&&(!cost.trim()||!Number.isFinite(Number(cost))))||!window.confirm('ยืนยันบันทึกการเปลี่ยนแปลงสต็อก?'))return;B(true);M('');try{const {error}=await db.rpc('change_inventory_stock',{p_resource_id:id,p_unit_id:unit,p_quantity:Number(qty),p_kind:kind,p_total_cost:kind==='stock_in'?Number(cost):null,p_note:note||null});if(error)throw error;Q('');K('');N('');M('บันทึกสำเร็จ');await load();}catch(e){M(e.message);}finally{B(false);}}
 return <section><h2>จัดการสต็อกเพิ่มเติม</h2><div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}}><button onClick={()=>SC(!creating)} style={{background:'#941c24',color:'white'}}>+ เพิ่มวัตถุดิบ / บรรจุภัณฑ์</button><button onClick={load}>รีเฟรช</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>{[['ทั้งหมด',rows.length],['แจ้งเตือน',rows.filter(low).length],['หมดสต็อก',rows.filter(r=>r.stock_quantity!=null&&Number(r.stock_quantity)===0).length],['ยังไม่กำหนด',rows.filter(r=>r.stock_quantity==null).length]].map(([label,n])=><div key={label} style={{padding:14,border:'1px solid #e5d5ce',borderRadius:12,background:'#fff8f4'}}>{label}<h2>{n}</h2></div>)}</div>{creating&&<form onSubmit={createResource} style={{display:'grid',gap:10,padding:16,border:'1px solid #e5d5ce',borderRadius:12,marginBottom:16}}><h3>เพิ่มรายการในคลัง</h3><label>ชื่อรายการ<input required maxLength={200} value={resourceName} onChange={e=>SR(e.target.value)}/></label><label>ประเภท<select value={resourceType} onChange={e=>ST(e.target.value)}><option value="other">วัตถุดิบสำหรับผลิต / อื่น ๆ</option><option value="packaging">บรรจุภัณฑ์</option></select></label><label>หน่วยหลัก<select value={baseUnit} onChange={e=>SB(e.target.value)}><option value="">กำหนดหน่วยเอง</option>{units.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>{!baseUnit&&<input required maxLength={80} placeholder="ชื่อหน่วยหลัก" value={customUnit} onChange={e=>SU(e.target.value)}/>}<button disabled={busy||!resourceName.trim()}>บันทึกรายการใหม่</button></form>}<div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}><input placeholder="ค้นหาวัตถุดิบ" value={search} onChange={e=>SS(e.target.value)}/><select value={view} onChange={e=>SV(e.target.value)}><option value="cards">การ์ด</option><option value="table">ตาราง</option><option value="compact">กะทัดรัด</option><option value="category">แยกหมวดหมู่</option><option value="dashboard">แดชบอร์ด</option><option value="gallery">แกลเลอรี</option><option value="warehouse">คลังสินค้า</option><option value="quick">แก้ไขด่วน</option><option value="board">กระดานสถานะ</option><option value="split">แบ่งหน้าจอ</option></select></div>{['table','warehouse','quick'].includes(view)?<div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>รายการ</th><th>คงเหลือ</th><th>สถานะ</th>{view==='warehouse'&&<><th>แจ้งเตือนเมื่อเหลือ (หน่วยหลัก)</th><th>ต้นทุนต่อหน่วยหลัก</th></>}<th>จัดการ</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td>{r.name}</td><td>{amount(r)}</td><td>{low(r)?'สต็อกต่ำ':r.stock_quantity==null?'ยังไม่กำหนด':'ปกติ'}</td>{view==='warehouse'&&<><td>{r.low_stock_quantity}</td><td>{r.cost_per_base_unit??'ไม่ทราบ'}</td></>}<td><button type="button" onClick={()=>{pick(r);if(view==='quick'){T('stock_in');Q('');K('');}}}>{view==='quick'?'เติมสต็อก':'เลือก'}</button></td></tr>)}</tbody></table></div>:['category','board','dashboard'].includes(view)?<div style={{display:'grid',gap:12,gridTemplateColumns:view==='board'?'repeat(auto-fit,minmax(150px,1fr))':'1fr'}}>{(view==='category'?[...new Set(visible.map(r=>r.resource_type))].map(t=>[({ingredient:'วัตถุดิบ',product:'สินค้า',soup:'น้ำซุป',sauce:'น้ำจิ้ม',seasoning:'เครื่องปรุง',packaging:'บรรจุภัณฑ์',other:'อื่น ๆ'})[t]||t,visible.filter(r=>r.resource_type===t)]):[['หมดสต็อก',visible.filter(r=>r.stock_quantity!=null&&Number(r.stock_quantity)===0)],['สต็อกต่ำ',visible.filter(r=>low(r)&&Number(r.stock_quantity)>0)],['ยังไม่กำหนด',visible.filter(r=>r.stock_quantity==null)],['ปกติ',visible.filter(r=>r.stock_quantity!=null&&Number(r.stock_quantity)>0&&!low(r))]]).map(([label,items])=><div key={label} style={{border:'1px solid #ddd',padding:12,borderRadius:10}}><h3>{label} ({items.length})</h3>{view==='dashboard'&&<progress max={Math.max(visible.length,1)} value={items.length}/ >}{items.map(r=><p key={r.id}><button type="button" onClick={()=>pick(r)}>{r.name}</button> {amount(r)}</p>)}</div>)}</div>:<div style={{display:'grid',gridTemplateColumns:['cards','gallery','split'].includes(view)?'repeat(auto-fit,minmax(150px,1fr))':'1fr',gap:10,marginBottom:20}}>{visible.map(r=><div key={r.id} style={{padding:view==='compact'?5:12,border:'1px solid #e5d5ce',borderRadius:10,background:id===r.id?'#fff0e5':'white'}}>{view==='gallery'&&<div style={{fontSize:36,textAlign:'center',background:'#fff1e7'}}> {r.resource_type==='packaging'?'📦':r.resource_type==='soup'?'🍲':'🥣'} </div>}<strong>{r.name}</strong><span style={{color:low(r)?'#b91c1c':'inherit',display:view==='compact'?'inline':'block'}}> {amount(r)} {low(r)?' • สต็อกต่ำ':''}</span><button type="button" onClick={()=>pick(r)}>จัดการ</button></div>)}{view==='split'&&<div style={{padding:12,border:'1px solid #ddd'}}><h3>รายละเอียดรายการที่เลือก</h3>{selected?<><p>{selected.name}</p><p>{amount(selected)}</p><p>ต้นทุนต่อหน่วยหลัก: {selected.cost_per_base_unit??'ไม่ทราบ'}</p><p>ใช้ฟอร์มด้านล่างเพื่อบันทึกสต็อก</p></>:<p>เลือกรายการ</p>}</div>}</div>}<form onSubmit={save} style={{display:"grid",gap:12,maxWidth:520}}><h3>บันทึกสต็อก</h3><select required value={id} onChange={e=>{I(e.target.value);V('');EX('');NN('');F('');}}><option value="">เลือกรายการ</option>{rows.filter(r=>r.active&&!r.ingredient_id&&!r.product_id).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><div><strong>เลือกหน่วยที่ซื้อหรือใช้</strong><div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:8}}>{choices.map(c=><button key={c.unit_id} type="button" aria-pressed={unit===c.unit_id} onClick={()=>V(c.unit_id)} style={{background:unit===c.unit_id?'#941c24':'white',color:unit===c.unit_id?'white':'#333'}}>{units.find(u=>u.id===c.unit_id)?.name}</button>)}</div></div><select value={kind} onChange={e=>T(e.target.value)}><option value="stock_in">เติมสต็อก</option><option value="stock_out">เบิก</option><option value="waste">ของเสีย</option><option value="adjustment">ปรับเพิ่ม/ลด</option></select><label>ปริมาณ<input style={fieldStyle} required type="number" min={kind==='adjustment'?undefined:0.00000001} step="any" value={qty} onChange={e=>Q(e.target.value)}/></label>{unit&&qty&&Number.isFinite(preview)&&<p style={{background:'#fff1e7',padding:12,borderRadius:8}}>ปริมาณตามหน่วยหลัก: {preview.toLocaleString('th-TH',{maximumFractionDigits:8})} {baseName}</p>}{kind==='stock_in'&&<label>ต้นทุนซื้อรวม<input required type="number" min="0" step="any" value={cost} onChange={e=>K(e.target.value)}/></label>}<label>หมายเหตุ<input required={kind!=='stock_in'} value={note} onChange={e=>N(e.target.value)}/></label><button disabled={busy}>บันทึก</button></form>{selected&&<div style={{marginTop:20,padding:16,border:'1px solid #e5d5ce',borderRadius:12}}><h3>หน่วยของ {selected.name}</h3><p>หน่วยหลัก: {baseName} (ไม่เปลี่ยนยอดสต็อกเดิม)</p><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>หน่วย</th><th>ปริมาณต่อ 1 หน่วย</th></tr></thead><tbody>{choices.map(c=><tr key={c.unit_id}><td>{units.find(u=>u.id===c.unit_id)?.name}</td><td>{Number(c.base_quantity).toLocaleString('th-TH',{maximumFractionDigits:8})} {baseName}</td></tr>)}</tbody></table></div>{autoUnits.length>0&&<div><h4>หน่วยมาตรฐาน (แปลงให้อัตโนมัติ)</h4>{autoUnits.map(u=><button key={u.id} type="button" disabled={busy} onClick={()=>addStandard(u)}>+ {u.name}</button>)}</div>}<button type="button" onClick={()=>SO(!unitOpen)} style={{marginTop:12}}>{unitOpen?'ปิดการเพิ่มหน่วย':'+ เพิ่มหน่วยพิเศษ'}</button>{unitOpen&&<form onSubmit={addUnit} style={{display:'grid',gap:12,marginTop:12}}><label>ซื้อมาเป็น<select style={fieldStyle} value={existing} onChange={e=>EX(e.target.value)}><option value="">กำหนดชื่อเอง</option>{units.filter(u=>u.active&&!choices.some(c=>c.unit_id===u.id)&&!autoUnits.some(a=>a.id===u.id)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>{!existing&&<input style={fieldStyle} required maxLength={80} value={newName} onChange={e=>NN(e.target.value)} placeholder="เช่น ขวด หรือ ลัง"/>}<label>1 {existing?units.find(u=>u.id===existing)?.name:newName||'หน่วยใหม่'} มีปริมาณเท่าไรในหน่วย {baseName}<input style={fieldStyle} required type="number" min="0.00000001" step="any" value={factor} onChange={e=>F(e.target.value)}/></label>{Number(factor)>0&&<p>ตัวอย่าง: ซื้อ 3 หน่วย = {(3*Number(factor)).toLocaleString('th-TH')} {baseName}</p>}<button disabled={busy}>บันทึกหน่วยใหม่</button></form>}</div>}<p role="status">{msg}</p></section>;
}

function OwnerSetupPanel({db,mode}) {
 const [data,D]=useState({}),[msg,M]=useState(''),[busy,B]=useState(false),[edit,E]=useState(''),[name,N]=useState(''),[category,C]=useState(''),[newCategory,NC]=useState(''),[unit,U]=useState('ชิ้น'),[price,P]=useState(''),[image,IM]=useState(''),[photoBusy,PB]=useState(false),[active,A]=useState(false),[date,DT]=useState(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})),[note,NT]=useState(''),[output,OUT]=useState(''),[parts,PS]=useState([]),[batches,BA]=useState('1');
 const tables=mode==='catalog'?['product_categories','products']:mode==='expenses'?['expense_categories','shop_expenses']:['inventory_resources','inventory_units','inventory_recipes','inventory_recipe_parts'];
 async function load(){const results=await Promise.all(tables.map(t=>db.from(t).select('*').limit(1000)));for(const r of results)if(r.error)throw r.error;D(Object.fromEntries(tables.map((t,i)=>[t,results[i].data||[]])));}
 useEffect(()=>{load().catch(e=>M(e.message));},[]);
 async function run(fn){if(busy)return;B(true);M('');try{await fn();await load();M('บันทึกสำเร็จ');}catch(e){M(e.message||String(e));}finally{B(false);}}
 async function check(q){const r=await q;if(r.error)throw r.error;return r.data;}
 const field={display:'block',width:'100%',padding:10,boxSizing:'border-box',border:'1px solid #dbcac3',borderRadius:8};
 const red={background:'#a71920',color:'white',fontWeight:600};
 const form={display:'grid',gap:12,maxWidth:650,padding:16,border:'1px solid #e5d5ce',borderRadius:12};
 const list=t=>data[t]||[];
 const resources=list('inventory_resources').filter(r=>r.active&&!r.ingredient_id&&!r.product_id);
 const label=r=>r.name+' ('+(list('inventory_units').find(u=>u.id===r.base_unit_id)?.name||'หน่วยหลัก')+')';
 const cats=list(mode==='catalog'?'product_categories':'expense_categories');
 function reset(){E('');N('');C('');P('');IM('');A(false);NT('');OUT('');PS([]);}
 return <section><h2>{mode==='catalog'?'สินค้าและหมวดหมู่':mode==='expenses'?'บันทึกค่าใช้จ่าย':'จัดการสูตรผลิต'}</h2><button type="button" onClick={()=>run(async()=>{})}>รีเฟรช</button><p role="status" aria-live="polite">{msg}</p>
 {mode!=='recipes'&&<form style={form} onSubmit={e=>{e.preventDefault();run(async()=>{await check(db.from(mode==='catalog'?'product_categories':'expense_categories').insert({name:newCategory.trim()}));NC('');});}}><strong>เพิ่มหมวดหมู่</strong><input style={field} required value={newCategory} onChange={e=>NC(e.target.value)} placeholder="ชื่อหมวดหมู่"/><button style={red} disabled={busy||!newCategory.trim()}>เพิ่มหมวดหมู่</button></form>}
 {mode==='catalog'&&<><p>รายการสินค้าแบบขายเป็นหน่วย (ยังไม่เปิดขายผ่านหน้าลูกค้าในชุดนี้)</p><form style={form} onSubmit={e=>{e.preventDefault();run(async()=>{const row={name:name.trim(),category_id:category||null,unit_name:unit.trim(),price:Number(price),image_url:image.trim()||null,is_available:active};if(edit)await check(db.from('products').update(row).eq('id',edit).select('id').single());else await check(db.from('products').insert(row));reset();});}}><h3>{edit?'แก้ไขสินค้า':'เพิ่มสินค้า'}</h3><label>ชื่อสินค้า<input style={field} required value={name} onChange={e=>N(e.target.value)}/></label><label>หมวดหมู่<select style={field} value={category} onChange={e=>C(e.target.value)}><option value="">ไม่ระบุ</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>หน่วยขาย<input style={field} required value={unit} onChange={e=>U(e.target.value)}/></label><label>ราคาต่อหน่วย (บาท)<input style={field} required type="number" min="0" step="0.01" value={price} onChange={e=>P(e.target.value)}/></label><div><label>รูปสินค้า (ไม่บังคับ)<input style={field} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||photoBusy} onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;PB(true);try{if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>15000000)throw Error('เลือกรูป JPG, PNG หรือ WebP ไม่เกิน 15 MB');const bitmap=await createImageBitmap(f);try{const scale=Math.min(1,800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));if(!blob)throw Error('แปลงรูปไม่สำเร็จ');const path=crypto.randomUUID()+'.jpg';await check(db.storage.from('product-images').upload(path,blob,{contentType:'image/jpeg',upsert:false}));IM(db.storage.from('product-images').getPublicUrl(path).data.publicUrl);M('อัปโหลดรูปสำเร็จ กรุณาบันทึกสินค้า');}finally{bitmap.close();}}catch(err){M(err.message||String(err));}finally{PB(false);}}}/></label>{photoBusy&&<p>กำลังอัปโหลดรูป...</p>}{image&&<div><img src={image} alt="ตัวอย่างรูปสินค้า" style={{width:140,height:140,objectFit:'cover',borderRadius:8}}/><button type="button" disabled={photoBusy||busy} onClick={()=>IM('')}>เอารูปออก</button></div>}</div><label><input type="checkbox" checked={active} onChange={e=>A(e.target.checked)}/> เปิดใช้งานสินค้า</label><button style={red} disabled={busy||photoBusy||!name.trim()||!unit.trim()}>บันทึกสินค้า</button><button type="button" onClick={reset}>ล้างฟอร์ม</button></form>{list('products').map(r=><div key={r.id} style={{padding:12,borderBottom:'1px solid #ddd'}}><>{r.image_url&&<img src={r.image_url} alt={r.name} loading="lazy" style={{width:64,height:64,objectFit:'cover',borderRadius:8,verticalAlign:'middle',marginRight:8}}/>}<strong>{r.name}</strong></> · {r.price} บาท/{r.unit_name} · {r.is_available?'เปิด':'ปิด'} <button onClick={()=>{E(r.id);N(r.name);C(r.category_id||'');U(r.unit_name);P(String(r.price));IM(r.image_url||'');A(r.is_available);}}>แก้ไข</button></div>)}</>}
 {mode==='expenses'&&<><form style={form} onSubmit={e=>{e.preventDefault();run(async()=>{await check(db.from('shop_expenses').insert({category_id:category,expense_date:date,amount:Number(price),note:note.trim()}));P('');NT('');});}}><h3>เพิ่มค่าใช้จ่าย</h3><label>วันที่<input style={field} required type="date" value={date} onChange={e=>DT(e.target.value)}/></label><label>หมวดหมู่<select style={field} required value={category} onChange={e=>C(e.target.value)}><option value="">เลือกหมวดหมู่</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>จำนวนเงิน<input style={field} required type="number" min="0.01" step="0.01" value={price} onChange={e=>P(e.target.value)}/></label><label>หมายเหตุ<input style={field} value={note} onChange={e=>NT(e.target.value)}/></label><button style={red} disabled={busy}>บันทึกค่าใช้จ่าย</button></form><p>ไม่บันทึกต้นทุนวัตถุดิบที่รวมในต้นทุนขายซ้ำเป็นค่าใช้จ่าย</p>{list('shop_expenses').slice().sort((a,b)=>b.expense_date.localeCompare(a.expense_date)).map(r=><p key={r.id}>{r.expense_date} · {cats.find(c=>c.id===r.category_id)?.name} · {r.amount} บาท · {r.note}</p>)}</>}
 {mode==='recipes'&&<><p>สร้างสูตรในหน่วยหลักของคลังสต็อกเพิ่มเติม ก่อนผลิตต้องมีสต็อกและต้นทุนส่วนผสมครบ</p><form style={form} onSubmit={e=>{e.preventDefault();run(async()=>{if(!parts.length||new Set(parts.map(p=>p.resource_id)).size!==parts.length||parts.some(p=>!p.resource_id||p.resource_id===output||!(Number(p.base_quantity)>0)))throw Error('ตรวจสอบส่วนผสมและปริมาณ ไม่ให้ซ้ำหรือใช้ผลผลิตเป็นส่วนผสม');const row={name:name.trim(),output_resource_id:output,output_quantity:Number(price),parts:parts.map(p=>({...p,base_quantity:Number(p.base_quantity)}))};await check(db.rpc('save_inventory_recipe_302',{p_recipe_id:edit||null,p_recipe:row}));reset();});}}><h3>{edit?'แก้ไขสูตร':'สร้างสูตร'}</h3><label>ชื่อสูตร<input style={field} required value={name} onChange={e=>N(e.target.value)}/></label><label>ผลผลิต<select style={field} required value={output} onChange={e=>OUT(e.target.value)}><option value="">เลือกผลผลิต</option>{resources.map(r=><option key={r.id} value={r.id}>{label(r)}</option>)}</select></label><label>ปริมาณผลผลิต (หน่วยหลัก)<input style={field} required type="number" min="0.00000001" step="any" value={price} onChange={e=>P(e.target.value)}/></label>{parts.map((p,i)=><div key={i}><select style={field} required value={p.resource_id} onChange={e=>PS(old=>old.map((x,j)=>j===i?{...x,resource_id:e.target.value}:x))}><option value="">เลือกส่วนผสม</option>{resources.filter(r=>r.id!==output).map(r=><option key={r.id} value={r.id}>{label(r)}</option>)}</select><input style={field} required type="number" min="0.00000001" step="any" placeholder="ปริมาณหน่วยหลัก" value={p.base_quantity} onChange={e=>PS(old=>old.map((x,j)=>j===i?{...x,base_quantity:e.target.value}:x))}/><button type="button" onClick={()=>PS(old=>old.filter((x,j)=>j!==i))}>ลบส่วนผสม</button></div>)}<button type="button" onClick={()=>PS(old=>[...old,{resource_id:'',base_quantity:''}])}>+ เพิ่มส่วนผสม</button><button style={red} disabled={busy||!name.trim()}>บันทึกสูตร</button><button type="button" onClick={reset}>ล้างฟอร์ม</button></form><label>จำนวนเท่าของสูตร<input style={field} type="number" min="0.00000001" step="any" value={batches} onChange={e=>BA(e.target.value)}/></label>{list('inventory_recipes').map(r=><div key={r.id} style={{padding:12,borderBottom:'1px solid #ddd'}}><strong>{r.name}</strong> · {r.output_quantity} หน่วยหลัก <button onClick={()=>{E(r.id);N(r.name);OUT(r.output_resource_id);P(String(r.output_quantity));PS(list('inventory_recipe_parts').filter(p=>p.recipe_id===r.id).map(p=>({resource_id:p.resource_id,base_quantity:String(p.base_quantity)})));}}>แก้ไข</button> <button style={red} disabled={busy||!(Number(batches)>0)||!r.active} onClick={()=>{if(window.confirm('ยืนยันผลิต '+r.name+' จำนวน '+batches+' เท่าของสูตร?'))run(()=>check(db.rpc('produce_inventory_recipe',{p_recipe_id:r.id,p_batches:Number(batches)})));}}>บันทึกการผลิต</button></div>)}</>}
 </section>;
}
