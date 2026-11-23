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

const defaultSauceSettings = {
  is_enabled: false, max_cups: 3, cup_capacity: 6,
  min_spoons: 1, max_ingredient_types: 6,
  custom_cup_price: 0, first_cup_free: false,
  free_cup_mode: 'none'
};
const money = value => Number(value || 0).toFixed(2);
const newSauceRecipe = { name: '', description: '', price: '0', is_available: true, sort_order: '0' };
const newSauceIngredient = { name: '', description: '', price_per_spoon: '0', max_spoons: '3', is_available: true, sort_order: '0' };

function App() {
  const [page, setPage] = useState('shop');
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

  async function loadSauces() {
    if (!db) return;
