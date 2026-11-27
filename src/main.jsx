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
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [start,S]=useState(today),[end,E]=useState(today),[summary,U]=useState(null),[rows,R]=useState([]),[orders,O]=useState([]),[error,X]=useState(''),[busy,B]=useState(false);
 async function load(){B(true);X('');U(null);R([]);O([]);try{const args={p_start:start,p_end:end};const results=await Promise.all(['shop_finance_summary','shop_finance_daily','shop_order_profit'].map(n=>db.rpc(n,args)));for(const r of results)if(r.error)throw r.error;U(results[0].data);R(results[1].data||[]);O(results[2].data||[]);}catch(e){X(e.message);}finally{B(false);}}
 const money=v=>v==null?'ต้นทุนไม่ครบ':Number(v).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})+' บาท';
 return <section><h2>รายงานการเงิน</h2><label>จาก <input type="date" value={start} onChange={e=>S(e.target.value)}/></label><label>ถึง <input type="date" value={end} onChange={e=>E(e.target.value)}/></label><button disabled={busy} onClick={load}>โหลดรายงาน</button><p role="alert">{error}</p>{summary&&<><p>ยอดขาย {money(summary.sales)} · {summary.orders} ออเดอร์</p><p>ต้นทุนที่บันทึก {money(summary.recorded_cost)}</p><p>ค่าใช้จ่าย {money(summary.expenses)}</p><h3 style={{color:summary.net_profit==null?'#b45309':summary.net_profit<0?'#dc2626':'#15803d'}}>{summary.net_profit==null?'ข้อมูลต้นทุนไม่ครบ':summary.net_profit<0?'ขาดทุนสุทธิ':summary.net_profit>0?'กำไรสุทธิ':'เท่าทุน'}: {money(summary.net_profit)}</h3><p>ออเดอร์ต้นทุนไม่ครบ {summary.incomplete_cost_orders}</p><h3>รายวัน</h3>{rows.map(r=><p key={r.report_date}>{r.report_date} | ยอดขาย {money(r.sales)} | สุทธิ {money(r.net_profit)}</p>)}<h3>แยกออเดอร์</h3>{orders.map(r=><p key={r.order_id}>{r.order_number} | ยอดขาย {money(r.revenue)} | กำไรขั้นต้น {money(r.gross_profit)}</p>)}</>}</section>;
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
