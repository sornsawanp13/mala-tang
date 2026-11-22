
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './style.css';

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

function App() {
  const [page, setPage] = useState('shop');
  const [ingredients, setIngredients] = useState([]);
  const [soups, setSoups] = useState([]);
  const [selectedWeights, setSelectedWeights] = useState({});
  const [cart, setCart] = useState([]);
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

  useEffect(() => {
    if (!db) return;

    loadMenu();

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
    if (!db || submitting || !cart.length || !soup) {
      return;
    }

    const availableIds = new Set(
      ingredients
        .filter(x => x.is_available !== false)
        .map(x => String(x.id))
    );

    if (
      cart.some(item =>
        !availableIds.has(String(item.ingredientId))
      )
    ) {
      setNotice(
        'มีสินค้าที่หมดแล้วในตะกร้า กรุณาลบออกก่อน'
      );
      return;
    }

    setSubmitting(true);
    setNotice('กำลังส่งออเดอร์...');

    try {
      const grouped = new Map();

      for (const item of cart) {
        const id = String(item.ingredientId);
        grouped.set(
          id,
          (grouped.get(id) || 0) + item.grams
        );
      }

      const items = [...grouped].map(
        ([ingredient_id, weight_grams]) => ({
          ingredient_id,
          weight_grams
        })
      );

      const { data, error } = await db.functions.invoke(
        'create-order',
        {
          body: {
            items,
            soup_name: soup,
            spice_level: spice,
            payment_method: 'cash'
          }
        }
      );

      if (error) throw error;

      if (!data?.success) {
        throw new Error(
          data?.error || 'ส่งออเดอร์ไม่สำเร็จ'
        );
      }

      setCart([]);

      setNotice(
        'รับออเดอร์แล้ว เลขที่ ' +
        data.order_number +
        ' ยอด ' +
        Number(data.total_amount).toFixed(2) +
        ' บาท กรุณาชำระเงินสดที่ร้าน'
      );
    } catch (error) {
      setNotice(
        'ส่งออเดอร์ไม่สำเร็จ: ' + error.message
      );
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
            <h2>① เลือกวัตถุดิบ</h2>
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
              <h2>② เลือกน้ำซุป</h2>

              <div className="choices">
                {soups.map(item => (
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

              <div className="line">
                <span>น้ำซุป</span>
                <b>{soup || '-'}</b>
              </div>

              <div className="line">
                <span>ความเผ็ด</span>
                <b>{spice}</b>
              </div>

              <div className="line">
                <strong>น้ำหนักรวม</strong>
                <strong>{totalWeight} กรัม</strong>
              </div>

              <div className="line">
                <strong>ยอดรวม</strong>
                <strong>
                  {totalPrice.toFixed(2)} บาท
                </strong>
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
                  : 'ยืนยันสั่งอาหาร'}
              </button>

              <p className="sub">
                ระบบทดสอบ ชำระเงินสดที่ร้าน
                ยังไม่เปิดรับชำระเงินออนไลน์
              </p>
            </section>
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
