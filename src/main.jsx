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
