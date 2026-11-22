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

                <div className="choices" style={{margin:'16px 0'}}>
                  <button className={adminTab === 'orders' ? 'active' : ''} onClick={() => setAdminTab('orders')}>ออเดอร์</button>
                  <button className={adminTab === 'ingredients' ? 'active' : ''} onClick={() => {setAdminTab('ingredients'); refreshIngredients();}}>จัดการวัตถุดิบ</button>
                </div>
                {adminTab === 'ingredients' ? (
                  <div>
                    <h2>จัดการวัตถุดิบและราคา</h2>
                    <p>ปรับข้อมูลได้ภายหลัง ราคาคิดเป็นบาทต่อ 100 กรัม</p>
                    <form onSubmit={saveIngredient} className="panel" style={{display:'grid',gap:12}}>
                      <h3>{editingId ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}</h3>
                      <label>ชื่อวัตถุดิบ <input required value={itemForm.name} onChange={e=>setItemForm({...itemForm,name:e.target.value})}/></label>
                      <label>หมวดหมู่ <input value={itemForm.category} onChange={e=>setItemForm({...itemForm,category:e.target.value})}/></label>
                      <label>ราคา (บาท / 100 กรัม) <input type="number" min="0.01" step="0.01" required value={itemForm.price_per_100g} onChange={e=>setItemForm({...itemForm,price_per_100g:e.target.value})}/></label>
                      <label>น้ำหนักที่ลูกค้าเลือกได้ (คั่นด้วยจุลภาค) <input required placeholder="50,100,150,200" value={itemForm.weight_options} onChange={e=>setItemForm({...itemForm,weight_options:e.target.value})}/></label>
                      <label><input type="checkbox" checked={itemForm.is_available} onChange={e=>setItemForm({...itemForm,is_available:e.target.checked})}/> เปิดขาย</label>
                      <button className="primary" type="submit" disabled={savingItem}>{savingItem ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}</button>
                      {editingId && <button type="button" onClick={()=>{setEditingId(null);setItemForm(emptyItem);}}>ยกเลิกแก้ไข</button>}
                    </form>
                    <h3>สินค้าทั้งหมด ({allIngredients.length})</h3>
                    {allIngredients.map(item => (
                      <article className="order" key={item.id}>
                        <b>{item.name} — {Number(item.price_per_100g).toFixed(2)} บาท / 100 กรัม</b>
                        <p>{item.category || 'วัตถุดิบ'} · น้ำหนัก {(item.weight_options || []).join(', ')} กรัม</p>
                        <p>{item.is_available ? '🟢 เปิดขาย' : '⚪ ปิดขาย'}</p>
                        <button onClick={()=>editIngredient(item)}>แก้ไข</button>{' '}
                        <button onClick={()=>toggleIngredient(item)}>{item.is_available ? 'ปิดขาย' : 'เปิดขาย'}</button>
                      </article>
                    ))}
                  </div>
                ) : <>
                <button className="primary" onClick={loadOrders}>
                  โหลดออเดอร์
                </button>

                {orders.map(x => (
                  <article className="order" key={x.id}>
                    <b>
                      {x.order_number} · {x.total_amount} บาท
                    </b>
                    <p>{x.soup_name} · {x.spice_level}</p>
                    
<div className="order-items">
  <h3>รายการวัตถุดิบ</h3>
  {(x.order_items || []).map(item => (
    <div className="line" key={item.id}>
      <span>
        {item.ingredient_name} · {item.weight_grams} กรัม
      </span>
      <b>{Number(item.price).toFixed(2)} บาท</b>
    </div>
  ))}
  <div className="line">
    <strong>น้ำหนักรวม</strong>
    <strong>{x.total_weight} กรัม</strong>
  </div>
</div>

                    <p>{x.order_status}</p>
                    <button onClick={() => updateOrder(x.id, 'preparing')}>
                      กำลังทำ
                    </button>
                    <button onClick={() => updateOrder(x.id, 'completed')}>
                      เสร็จแล้ว
                    </button>
                  </article>
                ))}
                </>}
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
