
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
        ' บาท กรุณาชำระเงินสดที่ร้าน'
      );

      setChosen({});
    } catch (e) {
      setNotice('ส่งออเดอร์ไม่สำเร็จ: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function login(e) {
    e.preventDefault();
    if (!db) return;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    setNotice(error ? error.message : 'เข้าสู่ระบบแล้ว');
  }

  async function loadOrders() {
    if (!db || !session) return;

    const { data, error } = await db
      .from('orders')
      .select('*,order_items(*)')
      .order('created_at', { ascending: false })
      .limit(100);

    setNotice(error ? error.message : '');
    setOrders(data || []);
  }

  async function updateOrder(id, status) {
    if (!db || !session) return;

    const { error } = await db
      .from('orders')
      .update({ order_status: status })
      .eq('id', id);

    if (error) {
      setNotice(error.message);
      return;
    }

    setNotice('อัปเดตแล้ว');
    await loadOrders();
  }

  return (
    <>
      <header>
        <nav>
          <b>麻辣烫 · MALA TANG</b>
          <button onClick={() => setPage(page === 'shop' ? 'admin' : 'shop')}>
            {page === 'shop' ? 'หลังร้าน' : 'หน้าร้าน'}
          </button>
        </nav>
        <h1>หม่าล่าทั่ง</h1>
        <p>เลือกวัตถุดิบ ชั่งน้ำหนัก อร่อยตามใจ</p>
        <span className="price">เริ่มต้น 25 บาท / 100 กรัม</span>
      </header>

      <main>
        {!db ? (
          <section className="panel">
            <h2>ยังไม่ได้เชื่อม Supabase</h2>
            <p>กรุณาตรวจสอบการตั้งค่า Environment variables</p>
          </section>
        ) : page === 'shop' ? (
          <>
            <h2>① เลือกวัตถุดิบ</h2>
            <p className="sub">เลือกน้ำหนักแต่ละรายการได้</p>

            <div className="grid">
              {ingredients.map(x => (
                <article key={x.id}>
                  <div className="emoji">🥢</div>
                  <div>
                    <strong>{x.name}</strong>
                    <small>
                      {x.category || 'วัตถุดิบ'} · {x.price_per_100g} บาท / 100 กรัม
                    </small>
                    <select
                      value={chosen[x.id] || ''}
                      onChange={e => setChosen({
                        ...chosen,
                        [x.id]: e.target.value
                      })}
                    >
                      <option value="">ไม่เลือก</option>
                      {(x.weight_options || [50, 100, 150, 200]).map(w => (
                        <option key={w} value={w}>{w} กรัม</option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>

            <section className="panel">
              <h2>② เลือกน้ำซุป</h2>
              <div className="choices">
                {soups.map(x => (
                  <button
                    key={x.id}
                    className={soup === x.name ? 'active' : ''}
                    onClick={() => setSoup(x.name)}
                  >
                    {x.name}
                  </button>
                ))}
              </div>

              <h2>③ เลือกระดับความเผ็ด</h2>
              <div className="choices">
                {['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดกลาง', 'เผ็ดมาก'].map(x => (
                  <button
                    key={x}
                    className={spice === x ? 'active' : ''}
                    onClick={() => setSpice(x)}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel cart">
              <h2>ตะกร้าสินค้า</h2>

              {cart.length ? cart.map(x => (
                <div className="line" key={x.id}>
                  <span>{x.name} · {x.grams} กรัม</span>
                  <b>{x.price.toFixed(2)} บาท</b>
                </div>
              )) : (
                <p>ยังไม่มีสินค้าในตะกร้า</p>
              )}

              <div className="line">
                <span>น้ำซุป</span>
                <b>{soup || '-'}</b>
              </div>

              <div className="line">
                <span>ความเผ็ด</span>
                <b>{spice}</b>
              </div>

              <div className="line">
                <b>น้ำหนักรวม {grams} กรัม</b>
                <strong>{total.toFixed(2)} บาท</strong>
              </div>

              <button
                className="primary"
                disabled={!cart.length || submitting || !soup}
                onClick={submitOrder}
              >
                {submitting ? 'กำลังส่งออเดอร์...' : 'สั่งอาหาร'}
              </button>

              <p className="sub">
                ระบบอยู่ระหว่างทดสอบ ยังไม่เปิดรับออเดอร์จริง
                และยังไม่เปิดรับชำระเงินออนไลน์
              </p>
            </section>
          </>
        ) : (
          <>
            <h2>ระบบหลังร้าน</h2>

            {!session ? (
              <form className="panel login" onSubmit={login}>
                <label>
                  อีเมล
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </label>

                <label>
                  รหัสผ่าน
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </label>

                <button className="primary">เข้าสู่ระบบ</button>
              </form>
            ) : (
              <section className="panel">
                <p>เข้าสู่ระบบ: {session.user.email}</p>

                <button onClick={() => db.auth.signOut()}>
                  ออกจากระบบ
                </button>

                <button className="primary" onClick={loadOrders}>
                  โหลดออเดอร์
                </button>

                {orders.map(x => (
                  <article className="order" key={x.id}>
                    <b>
                      {x.order_number} · {x.total_amount} บาท
                    </b>
                    <p>{x.soup_name} · {x.spice_level}</p>
                    <p>{x.order_status}</p>
                    <button onClick={() => updateOrder(x.id, 'preparing')}>
                      กำลังทำ
                    </button>
                    <button onClick={() => updateOrder(x.id, 'completed')}>
                      เสร็จแล้ว
                    </button>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        {notice && (
          <div className="notice" onClick={() => setNotice('')}>
            {notice} ✕
          </div>
        )}
      </main>

      <footer>หม่าล่าทั่ง · Mala Tang</footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
