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
