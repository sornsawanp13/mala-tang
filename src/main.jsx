
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;

const emptyItem = {
  name: '',
  category: 'วัตถุดิบ',
  price_per_100g: '25',
  weight_options: '50,100,150,200',
  is_available: true
};

function App() {
  const [ingredients, setIngredients] = useState([]);
  const [soups, setSoups] = useState([]);
  const [chosen, setChosen] = useState({});
  const [soup, setSoup] = useState('');
  const [spice, setSpice] = useState('เผ็ดกลาง');
  const [page, setPage] = useState('shop');
  const [adminTab, setAdminTab] = useState('orders');
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState([]);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [itemForm, setItemForm] = useState({ ...emptyItem });

  async function loadMenu() {
    if (!db) return;

    const [a, b] = await Promise.all([
      db.from('ingredients').select('*').order('name'),
      db.from('soups').select('*').eq('is_available', true)
    ]);

    if (a.error || b.error) {
      setNotice(a.error?.message || b.error?.message);
      return;
    }

    setIngredients(a.data || []);
    setSoups(b.data || []);

    if (b.data?.length) {
      setSoup(current =>
        b.data.some(x => x.name === current)
          ? current
          : b.data[0].name
      );
    }
  }

  useEffect(() => {
    if (!db) return;

    loadMenu();

    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = db.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
      }
    );

    return () => listener.subscription.unsubscribe();
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
        setIsAdmin(!error && Array.isArray(data) && data.length > 0);
        setCheckingAdmin(false);

        if (error) {
          setNotice('ตรวจสอบสิทธิ์ผู้ดูแลไม่ได้: ' + error.message);
        }
      }
    }

    checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const availableIngredients = ingredients.filter(
    x => x.is_available !== false
  );

  const cart = useMemo(() => (
    availableIngredients
      .filter(x => chosen[x.id])
      .map(x => ({
        ...x,
        grams: Number(chosen[x.id]),
        price:
          Number(chosen[x.id]) *
          Number(x.price_per_100g) / 100
      }))
  ), [ingredients, chosen]);

  const grams = cart.reduce((sum, x) => sum + x.grams, 0);
  const total = cart.reduce((sum, x) => sum + x.price, 0);

  async function submitOrder() {
    if (!db || submitting || !cart.length || !soup) return;

    setSubmitting(true);
    setNotice('กำลังส่งออเดอร์...');

    try {
      const { data, error } = await db.functions.invoke(
        'create-order',
        {
          body: {
            items: cart.map(x => ({
              ingredient_id: x.id,
              weight_grams: x.grams
            })),
            soup_name: soup,
            spice_level: spice,
            payment_method: 'cash'
          }
        }
      );

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'ส่งออเดอร์ไม่สำเร็จ');
      }

      setNotice(
        'รับออเดอร์แล้ว เลขที่ ' +
        data.order_number +
        ' ยอด ' +
        Number(data.total_amount).toFixed(2) +
        ' บาท กรุณาชำระเงินสดที่ร้าน'
      );

      setChosen({});
    } catch (error) {
      setNotice('ส่งออเดอร์ไม่สำเร็จ: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function login(event) {
    event.preventDefault();

    if (!db) return;

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    setNotice(error ? error.message : 'เข้าสู่ระบบแล้ว');
    setPassword('');
  }

  async function logout() {
    if (!db) return;

    const { error } = await db.auth.signOut();

    if (error) {
      setNotice(error.message);
    } else {
      setOrders([]);
      setIsAdmin(false);
      setNotice('ออกจากระบบแล้ว');
    }
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

    setOrders(data || []);
  }

  async function updateOrder(id, status) {
    if (!db || !session || !isAdmin) return;

    const { error } = await db
      .from('orders')
      .update({ order_status: status })
      .eq('id', id);

    if (error) {
      setNotice(error.message);
      return;
    }

    await loadOrders();
    setNotice('อัปเดตสถานะแล้ว');
  }

  function newIngredient() {
    setEditingId(null);
    setItemForm({ ...emptyItem });
  }

  function editIngredient(item) {
    setEditingId(item.id);
    setItemForm({
      name: item.name || '',
      category: item.category || 'วัตถุดิบ',
      price_per_100g: String(item.price_per_100g ?? 25),
      weight_options: (item.weight_options || []).join(','),
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

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      setNotice('กรุณากำหนดราคามากกว่า 0 บาท');
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
      setNotice('ตัวเลือกน้ำหนักต้องเป็นจำนวนเต็มบวก เช่น 50,100,150');
      return;
    }

    const uniqueWeights = [...new Set(weights)]
      .sort((a, b) => a - b);

    const payload = {
      name,
      category,
      price_per_100g: price,
      weight_options: uniqueWeights,
      is_available: itemForm.is_available
    };

    setSaving(true);

    try {
      let result;

      if (editingId) {
        result = await db
          .from('ingredients')
          .update(payload)
          .eq('id', editingId)
          .select();
      } else {
        result = await db
          .from('ingredients')
          .insert(payload)
          .select();
      }

      if (result.error) throw result.error;

      if (!result.data?.length) {
        throw new Error(
          'ไม่สามารถบันทึกได้ กรุณาตรวจสอบสิทธิ์ Supabase'
        );
      }

      await loadMenu();
      newIngredient();
      setNotice('บันทึกวัตถุดิบสำเร็จ');
    } catch (error) {
      setNotice('บันทึกไม่สำเร็จ: ' + error.message);
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
        is_available: !item.is_available
      })
      .eq('id', item.id)
      .select();

    setSaving(false);

    if (error || !data?.length) {
      setNotice(
        'เปลี่ยนสถานะไม่สำเร็จ: ' +
        (error?.message || 'กรุณาตรวจสอบสิทธิ์')
      );
      return;
    }

    await loadMenu();
    setNotice('เปลี่ยนสถานะสินค้าแล้ว');
  }

  return (
    <>
      <header>
        <nav>
          <b>麻辣烫 · MALA TANG</b>

          <button
            onClick={() => setPage(
              page === 'shop' ? 'admin' : 'shop'
            )}
          >
            {page === 'shop' ? 'หลังร้าน' : 'หน้าร้าน'}
          </button>
        </nav>

        <h1>หม่าล่าทั่ง</h1>
        <p>เลือกวัตถุดิบ ชั่งน้ำหนัก อร่อยตามใจ</p>
        <span className="price">
          เริ่มต้น 25 บาท / 100 กรัม
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
            <h2>① เลือกวัตถุดิบ</h2>
            <p className="sub">
              เลือกน้ำหนักแต่ละรายการได้
            </p>

            <div className="grid">
              {availableIngredients.map(x => (
                <article key={x.id}>
                  <div className="emoji">🥢</div>

                  <div>
                    <strong>{x.name}</strong>

                    <small>
                      {x.category || 'วัตถุดิบ'}
                      {' · '}
                      {x.price_per_100g} บาท / 100 กรัม
                    </small>

                    <select
                      value={chosen[x.id] || ''}
                      onChange={event => setChosen({
                        ...chosen,
                        [x.id]: event.target.value
                      })}
                    >
                      <option value="">ไม่เลือก</option>

                      {(x.weight_options || []).map(w => (
                        <option key={w} value={w}>
                          {w} กรัม
                        </option>
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
                    className={
                      soup === x.name ? 'active' : ''
                    }
                    onClick={() => setSoup(x.name)}
                  >
                    {x.name}
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
                ].map(x => (
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

              {cart.length ? (
                cart.map(x => (
                  <div className="line" key={x.id}>
                    <span>
                      {x.name} · {x.grams} กรัม
                    </span>

                    <b>{x.price.toFixed(2)} บาท</b>
                  </div>
                ))
              ) : (
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
                disabled={
                  !cart.length ||
                  submitting ||
                  !soup
                }
                onClick={submitOrder}
              >
                {submitting
                  ? 'กำลังส่งออเดอร์...'
                  : 'สั่งอาหาร'}
              </button>

              <p className="sub">
                ระบบอยู่ระหว่างทดสอบ
                ยังไม่เปิดรับออเดอร์จริง
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

                <button className="primary">
                  เข้าสู่ระบบ
                </button>
              </form>
            ) : checkingAdmin ? (
              <section className="panel">
                <p>กำลังตรวจสอบสิทธิ์ผู้ดูแล...</p>
              </section>
            ) : !isAdmin ? (
              <section className="panel">
                <h2>ไม่มีสิทธิ์จัดการร้าน</h2>
                <p>
                  บัญชีนี้ยังไม่ได้รับสิทธิ์ผู้ดูแล
                  กรุณาตรวจสอบตาราง admin_users
                </p>

                <button onClick={logout}>
                  ออกจากระบบ
                </button>
              </section>
            ) : (
              <section className="panel">
                <p>เข้าสู่ระบบ: {session.user.email}</p>

                <button onClick={logout}>
                  ออกจากระบบ
                </button>

                <div className="choices">
                  <button
                    className={
                      adminTab === 'orders' ? 'active' : ''
                    }
                    onClick={() => setAdminTab('orders')}
                  >
                    จัดการออเดอร์
                  </button>

                  <button
                    className={
                      adminTab === 'ingredients' ? 'active' : ''
                    }
                    onClick={() => {
                      setAdminTab('ingredients');
                      loadMenu();
                    }}
                  >
                    จัดการวัตถุดิบ
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

                    {orders.map(x => (
                      <article className="order" key={x.id}>
                        <b>
                          {x.order_number}
                          {' · '}
                          {Number(x.total_amount).toFixed(2)}
                          {' บาท'}
                        </b>

                        <p>
                          {x.soup_name}
                          {' · '}
                          {x.spice_level}
                        </p>

                        <h3>รายการวัตถุดิบ</h3>

                        {(x.order_items || []).map(item => (
                          <div
                            className="line"
                            key={item.id}
                          >
                            <span>
                              {item.ingredient_name}
                              {' · '}
                              {item.weight_grams} กรัม
                            </span>

                            <b>
                              {Number(item.price).toFixed(2)}
                              {' บาท'}
                            </b>
                          </div>
                        ))}

                        <div className="line">
                          <strong>น้ำหนักรวม</strong>
                          <strong>
                            {x.total_weight} กรัม
                          </strong>
                        </div>

                        <p>
                          สถานะ: {x.order_status}
                        </p>

                        <button
                          onClick={() =>
                            updateOrder(x.id, 'preparing')
                          }
                        >
                          กำลังทำ
                        </button>

                        <button
                          onClick={() =>
                            updateOrder(x.id, 'completed')
                          }
                        >
                          เสร็จแล้ว
                        </button>
                      </article>
                    ))}
                  </>
                ) : (
                  <>
                    <h2>จัดการวัตถุดิบ</h2>

                    <p>
                      เพิ่มสินค้า เปลี่ยนราคา น้ำหนัก
                      และเปิด–ปิดขายได้
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
                          placeholder="เช่น เห็ดเข็มทอง"
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
                        ราคาต่อ 100 กรัม (บาท)
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={itemForm.price_per_100g}
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
                          value={itemForm.weight_options}
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
                          checked={itemForm.is_available}
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
                          : 'บันทึกข้อมูลสินค้า'}
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

                    <h3>รายการวัตถุดิบทั้งหมด</h3>

                    {ingredients.map(x => (
                      <article
                        className="order"
                        key={x.id}
                      >
                        <b>{x.name}</b>

                        <p>
                          {x.category}
                          {' · '}
                          {x.price_per_100g}
                          {' บาท / 100 กรัม'}
                        </p>

                        <p>
                          น้ำหนัก:
                          {' '}
                          {(x.weight_options || []).join(', ')}
                          {' กรัม'}
                        </p>

                        <p>
                          {x.is_available
                            ? 'เปิดขาย'
                            : 'ปิดขาย'}
                        </p>

                        <button
                          onClick={() => editIngredient(x)}
                        >
                          แก้ไข
                        </button>

                        <button
                          disabled={saving}
                          onClick={() => toggleIngredient(x)}
                        >
                          {x.is_available
                            ? 'ปิดขาย'
                            : 'เปิดขาย'}
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

      <footer>หม่าล่าทั่ง · Mala Tang</footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
