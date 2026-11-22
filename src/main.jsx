import React,{useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{createClient}from'@supabase/supabase-js';
import './style.css';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const db=url&&key?createClient(url,key):null;
function App(){
  const [submitting,setSubmitting]=useState(false);
const[ingredients,setIngredients]=useState([]),[soups,setSoups]=useState([]),[chosen,setChosen]=useState({}),[soup,setSoup]=useState(''),[spice,setSpice]=useState('เผ็ดกลาง'),[page,setPage]=useState('shop'),[session,setSession]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[orders,setOrders]=useState([]),[notice,setNotice]=useState('');
useEffect(()=>{if(!db)return;Promise.all([db.from('ingredients').select('*').eq('is_available',true),db.from('soups').select('*').eq('is_available',true)]).then(([a,b])=>{if(a.error||b.error)setNotice(a.error?.message||b.error?.message);setIngredients(a.data||[]);setSoups(b.data||[]);if(b.data?.length)setSoup(b.data[0].name)});db.auth.getSession().then(x=>setSession(x.data.session));const{data:sub}=db.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>sub.subscription.unsubscribe()},[]);
const cart=useMemo(()=>ingredients.filter(x=>chosen[x.id]).map(x=>({...x,grams:Number(chosen[x.id]),price:Number(chosen[x.id])*Number(x.price_per_100g)/100})),[ingredients,chosen]);const grams=cart.reduce((a,x)=>a+x.grams,0),total=cart.reduce((a,x)=>a+x.price,0);


async function submitOrder(){
  if(submitting || !db || !cart.length || !soup) return;

  setSubmitting(true);
  setNotice('กำลังส่งออเดอร์...');

  try {
    const {data,error}=await db.functions.invoke(
      'create-order',
      {
        body:{
          items:cart.map(x=>({
            ingredient_id:x.id,
            weight_grams:x.grams
          })),
          soup_name:soup,
          spice_level:spice,
          payment_method:'cash'
        }
      }
    );

    if(error) throw error;
    if(!data?.success) {
      throw new Error(data?.error||'ส่งออเดอร์ไม่สำเร็จ');
    }

    setNotice(
      'รับออเดอร์แล้ว เลขที่ '+data.order_number+
      ' ยอด '+Number(data.total_amount).toFixed(2)+' บาท'+
      ' กรุณาชำระเงินสดที่ร้าน'
    );

    setChosen({});
  } catch(e) {
    setNotice('ส่งออเดอร์ไม่สำเร็จ: '+e.message);
  } finally {
    setSubmitting(false);
  }
}
{
  if(!db || !cart.length || !soup) return;

  setNotice('กำลังส่งออเดอร์...');

  try {
    const {data,error}=await db.functions.invoke(
      'create-order',
      {
        body:{
          items:cart.map(x=>({
            ingredient_id:x.id,
            weight_grams:x.grams
          })),
          soup_name:soup,
          spice_level:spice,
          payment_method:'cash'
        }
      }
    );

    if(error) throw error;
    if(!data?.success) {
      throw new Error(data?.error||'ส่งออเดอร์ไม่สำเร็จ');
    }

    setNotice(
      'รับออเดอร์แล้ว เลขที่ '+data.order_number+
      ' ยอด '+Number(data.total_amount).toFixed(2)+' บาท'+
      ' กรุณาชำระเงินสดที่ร้าน'
    );
    setChosen({});
  } catch(e) {
    setNotice('ส่งออเดอร์ไม่สำเร็จ: '+e.message);
  }
}

  async function login(e){e.preventDefault();const{error}=await db.auth.signInWithPassword({email,password});setNotice(error?error.message:'เข้าสู่ระบบแล้ว')}
async function loadOrders(){const{data,error}=await db.from('orders').select('*,order_items(*)').order('created_at',{ascending:false}).limit(100);setNotice(error?error.message:'');setOrders(data||[])}
async function updateOrder(id,status){const{error}=await db.from('orders').update({order_status:status}).eq('id',id);setNotice(error?error.message:'อัปเดตแล้ว');loadOrders()}

<button
  className="primary"
  disabled={!cart.length || submitting}
  onClick={submitOrder}
>
  {submitting ? 'กำลังส่งออเดอร์...' : 'สั่งอาหาร'}
</button>

createRoot(document.getElementById('root')).render(<App/>);
