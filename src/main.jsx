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
  const [payment,setPayment] = useState(null);
  const [qr,setQr] = useState('');
  const [slip,setSlip] = useState(null);
  const [uploading,setUploading] = useState(false);
  const uploadLock = React.useRef(false);
  useEffect(() => {
    let active=true;
    setQr('');
    if (payment?.payment_status === 'pending' && payment.promptpay_id && payment.upload_token) {
      Promise.resolve().then(()=>QRCode.toDataURL(promptpayPayload(payment.promptpay_id,payment.total_amount),{width:320,margin:4,errorCorrectionLevel:'M'})).then(url=>{if(active)setQr(url);}).catch(()=>{if(active)setNotice('สร้าง QR ไม่สำเร็จ กรุณาติดต่อร้าน');});
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
  const [ingredients, setIngredients] = useState([]);
  const [soups, setSoups] = useState([]);
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [itemForm, setItemForm] = useState({
    ...emptyIngredient
  });

  async function loadMenu() {
    if (!db) return;

    const [ingredientResult, soupResult] = await Promise.all([
      db.from('ingredients').select('*').order('name'),
      db.from('soups').select('*')
    ]);

    if (ingredientResult.error || soupResult.error) {
      setNotice(
        ingredientResult.error?.message ||
        soupResult.error?.message
      );
      return;
    }

    setIngredients(ingredientResult.data || []);

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
        setIsAdmin(
          !error &&
          Array.isArray(data) &&
          data.length > 0
        );
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

  function priceSauceCup(cup, index) {
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
    if (index === 0 && !bowls.some(b => b.payload.sauces.length)) {
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
  const savedPrice = bowls.reduce((n,b) => n+b.price,0);
  const grandTotal = savedPrice + totalPrice + sauceTotal;
  function currentBowl() {
    return { cooking_method: method, ...(method === 'soup' ? {soup_name:soup} : {}), spice_level:spice,
      items:cart.map(i=>({ingredient_id:i.ingredientId,weight_grams:i.grams})),
      sauces:sauceCups.map(c=>c.type==='recipe'?{type:'recipe',recipe_id:c.recipe_id}:{type:'custom',ingredients:c.ingredients}) };
  }
  function addBowl() {
    if (!cart.length || cart.length>40 || (method==='soup'&&!soup) || bowls.length>=9) return;
    setBowls(old=>[...old,{key:crypto.randomUUID(),payload:currentBowl(),weight:totalWeight,price:totalPrice+sauceTotal}]);
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
    if (cup.type === 'recipe') return cup.name;
    return 'ผสมเอง: ' + (cup.ingredients || []).map(part => {
      const item = sauceIngredients.find(x => String(x.id) === String(part.ingredient_id));
      return `${item?.name || 'ส่วนผสม'} ${part.spoons} ช้อน`;
    }).join(', ');
  }

  async function saveSauceSettings(event) {
    event.preventDefault();
    if (!isAdmin || saving || !db) return;
    const s = sauceSettings;
    const payload = {
      id: 1, is_enabled: Boolean(s.is_enabled),
      max_cups: Number(s.max_cups), cup_capacity: Number(s.cup_capacity),
      min_spoons: Number(s.min_spoons), max_ingredient_types: Number(s.max_ingredient_types),
      custom_cup_price: Number(s.custom_cup_price),
      first_cup_free: Boolean(s.first_cup_free), free_cup_mode: s.free_cup_mode
    };
    if (!Number.isInteger(payload.max_cups) || payload.max_cups < 0 ||
        !Number.isFinite(payload.cup_capacity) || payload.cup_capacity <= 0 ||
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
    if (!pending && ((!cart.length && !bowls.length) || cart.length>40 || (cart.length && method==='soup'&&!soup) || (!cart.length && sauceCups.length))) return;
    submitLock.current=true; setSubmitting(true);
    try {
      const payload = pending || {
        idempotency_key:crypto.randomUUID(),
        request_token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),
        payment_method:paymentMethod,
        bowls:[...bowls.map(b=>b.payload),...(cart.length?[currentBowl()]:[])]
      };
      sessionStorage.setItem('mala-v5-pending',JSON.stringify(payload)); setPending(payload);
      const {data,error}=await db.functions.invoke('create-order-v5',{body:payload});
      if(error || !data?.success) throw new Error('ยังไม่ได้รับการยืนยัน กรุณาลองส่งคำขอเดิมอีกครั้ง');
      if(data.payment_method==='promptpay') {
        setPayment(data);
        if(data.payment_status!=='pending') {sessionStorage.removeItem('mala-v5-pending');setPending(null);}
        setCart([]);setBowls([]);setSauceCups([]);
        setNotice('ออเดอร์ '+data.order_number+' · '+money(data.total_amount)+' บาท');
        return;
      }
      sessionStorage.removeItem('mala-v5-pending'); setPending(null);
      setCart([]); setBowls([]); setSauceCups([]);
      setNotice('รับออเดอร์ '+data.order_number+' ยอดชำระทั้งหมด '+money(data.total_amount)+' บาท กรุณาชำระเงินสดที่ร้าน');
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
    setOrders([]);
    setNotice('ออกจากระบบแล้ว');
  }

  async function loadOrders() {
    if (!db || !session || !isAdmin) return;

    const { data, error } = await db
      .from('orders')
      .select('*,order_items(*)')
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

  async function updateOrder(id, status) {
    if (!db || !session || !isAdmin) return;
    if (orders.find(o=>o.id===id)?.payment_status !== 'paid') return setNotice('ต้องตรวจสอบการชำระเงินก่อน');

    const { error } = await db
      .from('orders')
      .update({ order_status: status })
      .eq('id', id);

    if (error) {
      setNotice(error.message);
      return;
    }

    await loadOrders();
    setNotice('อัปเดตสถานะออเดอร์แล้ว');
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
        ) : page === 'shop' ? (
          <>
            {payment && <section className="panel">
              <h2>ออเดอร์ {payment.order_number}</h2>
              <h3>ยอดชำระทั้งหมด {money(payment.total_amount)} บาท</h3>
              {payment.payment_status==='pending' ? <>
                <p>ระบบทดสอบ: ยังไม่ต้องโอนเงินจริง</p>
                {qr && <img src={qr} alt="PromptPay QR" style={{width:280,maxWidth:'100%',display:'block',margin:'auto'}}/>}
                <p>ตรวจสอบชื่อผู้รับและยอดเงินในแอปธนาคารก่อนโอน</p>
                <label>แนบรูปสลิป<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading||submitting} onChange={e=>setSlip(e.target.files?.[0]||null)}/></label>
                <button className="primary" disabled={!slip||!qr||uploading||submitting} onClick={uploadSlip}>{uploading?'กำลังส่งสลิป...':'ส่งสลิป'}</button>
                <button disabled={uploading||submitting||!pending} onClick={submitOrder}>ตรวจสอบสถานะออเดอร์</button>
              </> : <><p>{payment.payment_status==='reviewing'?'ส่งสลิปแล้ว รอร้านตรวจสอบ':payment.payment_status==='paid'?'ชำระเงินแล้ว':'สถานะ: '+payment.payment_status}</p><button onClick={()=>{setPayment(null);setSlip(null);}}>กลับหน้าสั่งอาหาร</button></>}
            </section>}
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

              <h2>③ เลือกระดับความเผ็ด</h2>

              <div className="choices">
                {[
                  'ไม่เผ็ด',
                  'เผ็ดน้อย',
                  'เผ็ดกลาง',
                  'เผ็ดมาก'
                ].map(level => (
                  <button
                    key={level}
                    className={
                      spice === level ? 'active' : ''
                    }
                    onClick={() => setSpice(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </section>

            {sauceEnabled && (
              <section className="panel">
                <h2>④ เลือกน้ำจิ้ม</h2>
                <p className="sub">เลือกได้สูงสุด {maxCups} ถ้วย · ถ้วยละไม่เกิน {sauceSettings.cup_capacity} ช้อน</p>
                {sauceError && <p style={{ color: '#c62828' }}>{sauceError}</p>}
                <h3>น้ำจิ้มสูตรร้าน</h3>
                {availableRecipes.length ? (
                  <div>
                    <select value={recipeChoice || availableRecipes[0]?.id || ''} onChange={e => setRecipeChoice(e.target.value)}>
                      {availableRecipes.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.price)} บาท</option>)}
                    </select>
                    {availableRecipes.find(x => String(x.id) === String(recipeChoice || availableRecipes[0]?.id))?.description && (
                      <p className="sub">{availableRecipes.find(x => String(x.id) === String(recipeChoice || availableRecipes[0]?.id)).description}</p>
                    )}
                    <button className="primary" disabled={sauceCups.length + bowls.reduce((n,b)=>n+b.payload.sauces.length,0) >= maxCups} onClick={addRecipeCup}>+ เพิ่มน้ำจิ้มสูตรร้าน</button>
                  </div>
                ) : <p>ยังไม่มีน้ำจิ้มสูตรร้านที่เปิดขาย</p>}
                <h3>น้ำจิ้มผสมเอง</h3>
                {availableSauceIngredients.length ? (
                  <>
                    {availableSauceIngredients.map(item => (
                      <div className="line" key={item.id}>
                        <span>{item.name} · {money(item.price_per_spoon)} บาท/ช้อน {item.description ? `(${item.description})` : ''}</span>
                        <label>ช้อน{' '}
                          <input type="number" min="0" max={item.max_spoons} step="0.5" style={{ width: 85 }}
                            value={mixSpoons[item.id] ?? 0}
                            onChange={e => setMixSpoons(old => ({ ...old, [item.id]: e.target.value }))} />
                        </label>
                      </div>
                    ))}
                    <p className="sub">รวม {Object.values(mixSpoons).reduce((sum, x) => sum + (Number(x) || 0), 0)} ช้อน · ขั้นต่ำ {sauceSettings.min_spoons} ช้อน · สูงสุด {sauceSettings.max_ingredient_types} ชนิด</p>
                    <button className="primary" disabled={sauceCups.length + bowls.reduce((n,b)=>n+b.payload.sauces.length,0) >= maxCups} onClick={addCustomCup}>+ เพิ่มน้ำจิ้มผสมเอง</button>
                  </>
                ) : <p>ยังไม่มีส่วนผสมน้ำจิ้มที่เปิดขาย</p>}
                <p className="sub">ราคาเบสผสมเอง {money(sauceSettings.custom_cup_price)} บาท/ถ้วย · ราคาจริงคำนวณใหม่เมื่อยืนยันออเดอร์</p>
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
                <b>{spice}</b>
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

              {bowls.map((b,i)=><div className="line" key={b.key}><span>ถ้วยที่ {i+1} · {b.weight} กรัม · {money(b.price)} บาท</span><button onClick={()=>setBowls(old=>old.filter(x=>x.key!==b.key))}>ลบถ้วย</button></div>)}
              <button disabled={!cart.length || cart.length>40 || bowls.length>=9 || (method==='soup'&&!soup)} onClick={addBowl}>+ เพิ่มถ้วยถัดไป</button>
              <h3>เลือกวิธีชำระเงิน</h3>
              <div className="choices"><button className={paymentMethod==='cash'?'active':''} onClick={()=>setPaymentMethod('cash')}>เงินสดที่ร้าน</button><button className={paymentMethod==='promptpay'?'active':''} onClick={()=>setPaymentMethod('promptpay')}>PromptPay QR</button></div>
              <button
                className="primary"
                disabled={(!cart.length&&!bowls.length)||cart.length>40||(!cart.length&&sauceCups.length>0)||(cart.length>0&&method==='soup'&&!soup)||submitting||!!pending}
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
                  <button
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

                  <button
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
                  <button className={adminTab === 'sauces' ? 'active' : ''}
                    onClick={() => { setAdminTab('sauces'); loadSauces(); }}>
                    จัดการน้ำจิ้ม
                  </button>
                </div>

                {adminTab === 'orders' ? (
                  <>
                    <h2>รายการออเดอร์</h2>

                    <button
                      className="primary"
                      onClick={loadOrders}
                    >
                      โหลดออเดอร์
                    </button>

                    {orders.map(order => (
                      <article
                        className="order"
                        key={order.id}
                      >
                        <b>
                          {order.order_number}
                          {' · '}
                          {Number(
                            order.total_amount
                          ).toFixed(2)}
                          {' บาท'}
                        </b>

                        <p>
                          {order.soup_name}
                          {' · '}
                          {order.spice_level}
                        </p>

                        <h3>รายการสินค้า</h3>

                        {(order.order_items || []).map(
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

                        {(order.order_sauces || []).length > 0 && <>
                          <h3>น้ำจิ้ม</h3>
                          {order.order_sauces.map(cup => (
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

                        <p>
                          สถานะ:
                          {' '}
                          {order.order_status}
                        </p>

                        <button
                          onClick={() =>
                            updateOrder(
                              order.id,
                              'preparing'
                            )
                          }
                        >
                          กำลังทำ
                        </button>

                        <button
                          onClick={() =>
                            updateOrder(
                              order.id,
                              'completed'
                            )
                          }
                        >
                          เสร็จแล้ว
                        </button>
                      </article>
                    ))}
                  </>
                ) : adminTab === 'sauces' ? (
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
                        ['custom_cup_price', 'ราคาเบสผสมเอง (บาท)', 0.01]
                      ].map(([field, label, step]) => (
                        <label key={field}>{label}
                          <input type="number" min="0" step={step} value={sauceSettings[field]}
                            onChange={e => setSauceSettings(old => ({ ...old, [field]: e.target.value }))} required />
                        </label>
                      ))}
                      <label>โหมดถ้วยแรกฟรี
                        <select value={sauceSettings.free_cup_mode} onChange={e => setSauceSettings(old => ({ ...old, free_cup_mode: e.target.value }))}>
                          <option value="none">ไม่ฟรี</option>
                          <option value="full_cup">ฟรีทั้งถ้วยแรก</option>
                          <option value="base_only">ฟรีเฉพาะราคาเบสผสมเองถ้วยแรก</option>
                          <option value="recipe_only">ฟรีถ้วยแรกเฉพาะสูตรร้าน</option>
                        </select>
                      </label>
                      <button type="submit" className="primary" disabled={saving}>บันทึกการตั้งค่า</button>
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
