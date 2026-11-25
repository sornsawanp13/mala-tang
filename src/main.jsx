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
  const paymentPanel = React.useRef(null);
  useEffect(() => {
    if (page === 'shop' && payment) paymentPanel.current?.scrollIntoView({behavior:'smooth',block:'start'});
  }, [page, payment?.order_id, payment?.payment_status, qr]);
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
