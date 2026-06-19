const config = window.CLOUD_CONFIG || {};
const isConfigured =
  config.supabaseUrl &&
  config.supabaseKey &&
  !config.supabaseUrl.includes("请填写") &&
  !config.supabaseKey.includes("请填写");

let cloud = null;
let currentUser = null;
let customers = [];
let authMode = "login";
let toastTimer;

const $ = id => document.getElementById(id);
const elements = {
  authPage: $("authPage"), appShell: $("appShell"), setupNotice: $("setupNotice"),
  authForm: $("authForm"), authEmail: $("authEmail"), authPassword: $("authPassword"),
  authTitle: $("authTitle"), authDescription: $("authDescription"), authSubmitBtn: $("authSubmitBtn"),
  forgotPasswordBtn: $("forgotPasswordBtn"), userEmail: $("userEmail"), logoutBtn: $("logoutBtn"),
  loadingLayer: $("loadingLayer"), syncText: $("syncText"),
  form: $("customerForm"), customerId: $("customerId"), name: $("name"), contact: $("contact"),
  source: $("source"), intent: $("intent"), concern: $("concern"), status: $("status"),
  followUpDate: $("followUpDate"), notes: $("notes"), formTitle: $("formTitle"),
  submitBtn: $("submitBtn"), cancelEditBtn: $("cancelEditBtn"), resetBtn: $("resetBtn"),
  searchInput: $("searchInput"), intentFilter: $("intentFilter"), statusFilter: $("statusFilter"),
  tableBody: $("customerTableBody"), tableEmptyState: $("tableEmptyState"),
  tableWrap: document.querySelector(".table-wrap"), resultText: $("resultText"),
  todayList: $("todayList"), overdueList: $("overdueList"), toast: $("toast")
};

function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show${type === "error" ? " error" : ""}`;
  toastTimer = setTimeout(() => elements.toast.className = "toast", 2800);
}

function setLoading(show) {
  elements.loadingLayer.classList.toggle("hidden", !show);
}

function setSyncState(state, text) {
  const chip = document.querySelector(".sync-chip");
  chip.className = `sync-chip${state === "ok" ? "" : ` ${state}`}`;
  elements.syncText.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "未设置";
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function daysOverdue(value) {
  const today = new Date(`${getLocalDateString()}T00:00:00`);
  const date = new Date(`${value}T00:00:00`);
  return Math.round((today - date) / 86400000);
}

function mapCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    source: row.source,
    intent: row.intent,
    concern: row.concern,
    status: row.status,
    followUpDate: row.follow_up_date || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getActiveCustomers() {
  return customers.filter(item => !["已成交", "已流失"].includes(item.status));
}

function getTodayCustomers() {
  const today = getLocalDateString();
  return getActiveCustomers().filter(item => item.followUpDate === today);
}

function getOverdueCustomers() {
  const today = getLocalDateString();
  return getActiveCustomers()
    .filter(item => item.followUpDate && item.followUpDate < today)
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
}

function intentClass(value) {
  return { 高: "intent-high", 中: "intent-medium", 低: "intent-low" }[value] || "intent-low";
}

function statusClass(value) {
  return {
    新客户: "status-new", 已沟通: "status-contacted", 待回访: "status-follow",
    已成交: "status-won", 已流失: "status-lost"
  }[value] || "status-new";
}

function renderStats() {
  const today = getTodayCustomers();
  const overdue = getOverdueCustomers();
  $("totalCount").textContent = customers.length;
  $("highIntentCount").textContent = customers.filter(item => item.intent === "高").length;
  $("todayCount").textContent = today.length;
  $("overdueCount").textContent = overdue.length;
  $("wonCount").textContent = customers.filter(item => item.status === "已成交").length;
  $("lostCount").textContent = customers.filter(item => item.status === "已流失").length;
  $("todayBadge").textContent = `${today.length} 人`;
  $("overdueBadge").textContent = `${overdue.length} 人`;
}

function followItem(customer, overdue = false) {
  const extra = overdue ? `逾期 ${daysOverdue(customer.followUpDate)} 天` : customer.status;
  return `<div class="follow-item">
    <div><strong>${escapeHtml(customer.name)}</strong><span> · ${escapeHtml(customer.intent)}意向</span></div>
    <span class="follow-contact">${escapeHtml(customer.contact)} · ${escapeHtml(extra)}</span>
    <button class="follow-action" type="button" data-edit-id="${customer.id}">去跟进</button>
  </div>`;
}

function renderFocusLists() {
  const today = getTodayCustomers();
  const overdue = getOverdueCustomers();
  elements.todayList.innerHTML = today.length
    ? today.map(item => followItem(item)).join("")
    : '<div class="panel-empty"><div><span>✓</span>今天没有待跟进客户</div></div>';
  elements.overdueList.innerHTML = overdue.length
    ? overdue.map(item => followItem(item, true)).join("")
    : '<div class="panel-empty"><div><span>✓</span>太棒了，没有逾期客户</div></div>';
}

function filteredCustomers() {
  const keyword = elements.searchInput.value.trim().toLowerCase();
  const intent = elements.intentFilter.value;
  const status = elements.statusFilter.value;
  return [...customers].filter(item => {
    const text = `${item.name} ${item.contact} ${item.source}`.toLowerCase();
    return (!keyword || text.includes(keyword)) &&
      (!intent || item.intent === intent) &&
      (!status || item.status === status);
  }).sort((a, b) => {
    if (a.followUpDate && b.followUpDate) return a.followUpDate.localeCompare(b.followUpDate);
    if (a.followUpDate) return -1;
    if (b.followUpDate) return 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

function customerRow(customer) {
  const overdue = customer.followUpDate &&
    customer.followUpDate < getLocalDateString() &&
    !["已成交", "已流失"].includes(customer.status);
  return `<tr>
    <td data-label="客户"><div class="customer-cell"><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.contact)}</span></div></td>
    <td data-label="来源">${escapeHtml(customer.source)}</td>
    <td data-label="意向"><span class="tag ${intentClass(customer.intent)}">${escapeHtml(customer.intent)}</span></td>
    <td data-label="顾虑">${escapeHtml(customer.concern)}</td>
    <td data-label="状态"><span class="tag ${statusClass(customer.status)}">${escapeHtml(customer.status)}</span></td>
    <td data-label="下次跟进"><span class="${overdue ? "overdue-date" : ""}">${formatDate(customer.followUpDate)}</span>${overdue ? `<div class="date-subtext">逾期 ${daysOverdue(customer.followUpDate)} 天</div>` : ""}</td>
    <td data-label="操作"><div class="action-group">
      <button class="row-action" type="button" data-edit-id="${customer.id}">编辑</button>
      <button class="row-action delete" type="button" data-delete-id="${customer.id}">删除</button>
    </div></td>
  </tr>`;
}

function renderTable() {
  const result = filteredCustomers();
  elements.tableBody.innerHTML = result.map(customerRow).join("");
  elements.resultText.textContent = `显示 ${result.length} 位，共 ${customers.length} 位客户`;
  elements.tableWrap.classList.toggle("hidden", result.length === 0);
  elements.tableEmptyState.classList.toggle("hidden", result.length !== 0);
}

function renderAll() {
  renderStats();
  renderFocusLists();
  renderTable();
}

async function loadCustomers(showSuccess = false) {
  if (!currentUser) return;
  setSyncState("syncing", "正在同步");
  const { data, error } = await cloud
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    setSyncState("error", "同步失败");
    showToast(`读取失败：${error.message}`, "error");
    return;
  }
  customers = (data || []).map(mapCustomer);
  renderAll();
  setSyncState("ok", "云端已同步");
  if (showSuccess) showToast("数据已刷新");
}

function resetForm() {
  elements.form.reset();
  elements.customerId.value = "";
  elements.intent.value = "中";
  elements.concern.value = "考虑中";
  elements.status.value = "新客户";
  elements.formTitle.textContent = "添加客户";
  elements.submitBtn.textContent = "保存客户";
  elements.cancelEditBtn.classList.add("hidden");
}

async function saveCustomer(event) {
  event.preventDefault();
  const customer = {
    user_id: currentUser.id,
    name: elements.name.value.trim(),
    contact: elements.contact.value.trim(),
    source: elements.source.value,
    intent: elements.intent.value,
    concern: elements.concern.value,
    status: elements.status.value,
    follow_up_date: elements.followUpDate.value || null,
    notes: elements.notes.value.trim()
  };
  if (!customer.name || !customer.contact) {
    showToast("请填写客户姓名和联系方式", "error");
    return;
  }

  elements.submitBtn.disabled = true;
  setSyncState("syncing", "正在保存");
  const editingId = elements.customerId.value;
  const query = editingId
    ? cloud.from("customers").update(customer).eq("id", editingId)
    : cloud.from("customers").insert(customer);
  const { error } = await query;
  elements.submitBtn.disabled = false;

  if (error) {
    setSyncState("error", "保存失败");
    showToast(`保存失败：${error.message}`, "error");
    return;
  }
  resetForm();
  await loadCustomers();
  showToast(editingId ? "客户信息已更新" : "客户添加成功");
}

function editCustomer(id) {
  const customer = customers.find(item => item.id === id);
  if (!customer) return;
  elements.customerId.value = customer.id;
  elements.name.value = customer.name;
  elements.contact.value = customer.contact;
  elements.source.value = customer.source;
  elements.intent.value = customer.intent;
  elements.concern.value = customer.concern;
  elements.status.value = customer.status;
  elements.followUpDate.value = customer.followUpDate || "";
  elements.notes.value = customer.notes || "";
  elements.formTitle.textContent = `编辑客户：${customer.name}`;
  elements.submitBtn.textContent = "保存修改";
  elements.cancelEditBtn.classList.remove("hidden");
  $("customerFormSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteCustomer(id) {
  const customer = customers.find(item => item.id === id);
  if (!customer || !window.confirm(`确定删除客户“${customer.name}”吗？`)) return;
  setSyncState("syncing", "正在删除");
  const { error } = await cloud.from("customers").delete().eq("id", id);
  if (error) {
    setSyncState("error", "删除失败");
    showToast(`删除失败：${error.message}`, "error");
    return;
  }
  await loadCustomers();
  showToast("客户已删除");
}

function handleAction(event) {
  const editButton = event.target.closest("[data-edit-id]");
  const deleteButton = event.target.closest("[data-delete-id]");
  if (editButton) editCustomer(editButton.dataset.editId);
  if (deleteButton) deleteCustomer(deleteButton.dataset.deleteId);
}

function switchAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  const registering = mode === "register";
  elements.authTitle.textContent = registering ? "创建门店账号" : "欢迎回来";
  elements.authDescription.textContent = registering ? "注册后即可保存云端客户资料" : "登录后查看你的门店客户";
  elements.authSubmitBtn.textContent = registering ? "注册账号" : "登录";
  elements.authPassword.autocomplete = registering ? "new-password" : "current-password";
  elements.forgotPasswordBtn.classList.toggle("hidden", registering);
}

async function handleAuth(event) {
  event.preventDefault();
  if (!isConfigured) {
    showToast("请先配置 Supabase 云数据库", "error");
    return;
  }
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  elements.authSubmitBtn.disabled = true;
  elements.authSubmitBtn.textContent = "请稍候…";

  const result = authMode === "register"
    ? await cloud.auth.signUp({ email, password })
    : await cloud.auth.signInWithPassword({ email, password });

  elements.authSubmitBtn.disabled = false;
  switchAuthMode(authMode);
  if (result.error) {
    showToast(authErrorMessage(result.error.message), "error");
    return;
  }
  if (authMode === "register" && !result.data.session) {
    showToast("注册成功，请前往邮箱点击确认链接");
  } else {
    showToast("登录成功");
  }
}

function authErrorMessage(message) {
  const map = {
    "Invalid login credentials": "邮箱或密码错误",
    "Email not confirmed": "请先前往邮箱确认账号",
    "User already registered": "这个邮箱已经注册",
    "Password should be at least 6 characters": "密码至少需要 6 位"
  };
  return map[message] || message;
}

async function resetPassword() {
  if (!cloud) {
    showToast("请先配置 Supabase 云数据库", "error");
    return;
  }
  const email = elements.authEmail.value.trim();
  if (!email) {
    showToast("请先输入注册邮箱", "error");
    elements.authEmail.focus();
    return;
  }
  const { error } = await cloud.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  showToast(error ? `发送失败：${error.message}` : "重置邮件已发送，请检查邮箱", error ? "error" : "success");
}

async function logout() {
  await cloud.auth.signOut();
  customers = [];
  renderAll();
}

async function handleSession(session) {
  currentUser = session?.user || null;
  elements.authPage.classList.toggle("hidden", Boolean(currentUser));
  elements.appShell.classList.toggle("hidden", !currentUser);
  if (!currentUser) return;
  elements.userEmail.textContent = currentUser.email || "已登录";
  setLoading(true);
  await loadCustomers();
  setLoading(false);
}

function exportCsv() {
  if (!customers.length) {
    showToast("暂无客户数据可以导出", "error");
    return;
  }
  const rows = [
    ["客户姓名", "电话/微信", "客户来源", "意向等级", "客户顾虑", "当前状态", "下次跟进日期", "备注"],
    ...customers.map(item => [item.name, item.contact, item.source, item.intent, item.concern, item.status, item.followUpDate, item.notes])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `门店客户数据_${getLocalDateString()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("CSV 文件已导出");
}

async function initialize() {
  document.querySelectorAll("[data-auth-mode]").forEach(button => {
    button.addEventListener("click", () => switchAuthMode(button.dataset.authMode));
  });
  elements.authForm.addEventListener("submit", handleAuth);
  elements.forgotPasswordBtn.addEventListener("click", resetPassword);
  elements.logoutBtn.addEventListener("click", logout);
  elements.form.addEventListener("submit", saveCustomer);
  elements.resetBtn.addEventListener("click", resetForm);
  elements.cancelEditBtn.addEventListener("click", resetForm);
  $("refreshBtn").addEventListener("click", () => loadCustomers(true));
  $("exportBtn").addEventListener("click", exportCsv);
  $("goToFormBtn").addEventListener("click", () => {
    resetForm();
    $("customerFormSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.searchInput.addEventListener("input", renderTable);
  elements.intentFilter.addEventListener("change", renderTable);
  elements.statusFilter.addEventListener("change", renderTable);
  elements.tableBody.addEventListener("click", handleAction);
  elements.todayList.addEventListener("click", handleAction);
  elements.overdueList.addEventListener("click", handleAction);

  if (!isConfigured || !window.supabase) {
    elements.setupNotice.classList.remove("hidden");
    elements.authSubmitBtn.disabled = true;
    return;
  }

  cloud = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  const { data } = await cloud.auth.getSession();
  await handleSession(data.session);
  cloud.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });
}

initialize();
