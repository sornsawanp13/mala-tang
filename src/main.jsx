
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;

function App() {
  const [ingredients, setIngredients] = useState([]);
  const [soups, setSoups] = useState([]);
  const [chosen, setChosen] = useState({});
  const [soup, setSoup] = useState('');
  const [spice, setSpice] = useState('เผ็ดกลาง');
  const [page, setPage] = useState('shop');
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState([]);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [allIngredients, setAllIngredients] = useState([]);
  const [adminTab, setAdminTab] = useState('orders');
  const [editingId, setEditingId] = useState(null);
  const [savingItem, setSavingItem] = useState(false);
  const emptyItem = { name: '', category: 'วัตถุดิบ', price_per_100g: '25', weight_options: '50,100,150,200', is_available: true };
  const [itemForm, setItemForm] = useState(emptyItem);

  useEffect(() => {
    if (!db) return;

    Promise.all([
      db.from('ingredients').select('*').eq('is_available', true),
      db.from('soups').select('*').eq('is_available', true)
    ]).then(([a, b]) => {
      if (a.error || b.error) {
        setNotice(a.error?.message || b.error?.message);
      }
      setIngredients(a.data || []);
      setSoups(b.data || []);
      if (b.data?.length) setSoup(b.data[0].name);
    });

    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: sub } = db.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const cart = useMemo(() => (
    ingredients
      .filter(x => chosen[x.id])
      .map(x => ({
        ...x,
        grams: Number(chosen[x.id]),
        price: Number(chosen[x.id]) * Number(x.price_per_100g) / 100
      }))
  ), [ingredients, chosen]);

  const grams = cart.reduce((sum, x) => sum + x.grams, 0);
  const total = cart.reduce((sum, x) => sum + x.price, 0);

  async function submitOrder() {
    if (submitting || !db || !cart.length || !soup) return;

    setSubmitting(true);
    setNotice('กำลังส่งออเดอร์...');

    try {
      const { data, error } = await db.functions.invoke('create-order', {
        body: {
          items: cart.map(x => ({
            ingredient_id: x.id,
            weight_grams: x.grams
          })),
          soup_name: soup,
          spice_level: spice,
          payment_method: 'cash'
        }
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'ส่งออเดอร์ไม่สำเร็จ');
      }

      setNotice(
        'รับออเดอร์แล้ว เลขที่ ' + data.order_number +
        ' ยอด ' + Number(data.total_amount).toFixed(2) +
