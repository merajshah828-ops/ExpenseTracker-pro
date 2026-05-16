(function() {
    // ============ DATA STORAGE ============
    let transactions = [];
    let goals = [];
    let recurringExpenses = [];
    let categoryBudgets = {};
    let totalBudget = 0;
    let dailyLimit = 0;
    let defaultPaymentMethod = "Cash";
    let editingTransactionId = null;
    let notificationsEnabled = true;
    let notifications = [];
    
    // Quick Add Items
    let quickAddItems = [
        { category: "Groceries", amount: 500, icon: "🛒" },
        { category: "Food & Dining", amount: 300, icon: "🍔" },
        { category: "Transport", amount: 100, icon: "🚗" },
        { category: "Shopping", amount: 200, icon: "🛍️" }
    ];
    
    let currentTransactionMonth = new Date();
    let searchQuery = '';
    let filterType = 'all';
    let filterCategory = 'all';
    let filterPaymentMethod = 'all';
    let filterDateFrom = '';
    let filterDateTo = '';
    let sortBy = 'date_desc';
    let currentEditingQuickIndex = -1;

    // Chart instances
    let weeklyTrendChart = null;
    let incomeExpenseBarChart = null;
    let expensePieChart = null;
    let monthlyTrendChart = null;

    // ============ CURRENCY SYSTEM ============
    const currencies = {
        'USD': { symbol: '$', name: 'US Dollar', rate: 1.0 },
        'EUR': { symbol: '€', name: 'Euro', rate: 0.92 },
        'GBP': { symbol: '£', name: 'British Pound', rate: 0.79 },
        'INR': { symbol: '₹', name: 'Indian Rupee', rate: 83.5 },
        'JPY': { symbol: '¥', name: 'Japanese Yen', rate: 151.2 },
        'AUD': { symbol: 'A$', name: 'Australian Dollar', rate: 1.52 },
        'CAD': { symbol: 'C$', name: 'Canadian Dollar', rate: 1.37 },
        'SGD': { symbol: 'S$', name: 'Singapore Dollar', rate: 1.35 },
        'AED': { symbol: 'د.إ', name: 'UAE Dirham', rate: 3.67 },
        'CNY': { symbol: '¥', name: 'Chinese Yuan', rate: 7.24 }
    };
    
    let currentCurrency = 'INR';
    
    function formatAmount(amountINR) {
        const converted = amountINR / currencies[currentCurrency].rate;
        const symbol = currencies[currentCurrency].symbol;
        return symbol + converted.toFixed(2);
    }

    // ============ NOTIFICATION SYSTEM ============
    function addNotification(title, message, type = 'info') {
        if (!notificationsEnabled) return;
        
        const notification = {
            id: Date.now(),
            title: title,
            message: message,
            type: type,
            time: new Date().toLocaleTimeString(),
            read: false
        };
        
        notifications.unshift(notification);
        if (notifications.length > 50) notifications.pop();
        
        saveNotifications();
        updateNotificationUI();
        showToast(message);
        
        // Browser notification if permitted
        if (Notification.permission === 'granted') {
            new Notification(title, { body: message });
        }
        
        // Update badge
        updateNotificationBadge();
    }
    
    function updateNotificationUI() {
        const container = document.getElementById('notificationList');
        const unreadCount = notifications.filter(n => !n.read).length;
        const badge = document.getElementById('notificationBadge');
        
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
        
        if (!container) return;
        
        if (notifications.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:20px;">No notifications</div>';
            return;
        }
        
        container.innerHTML = notifications.map(n => `
            <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead(${n.id})">
                <div class="notification-title">${n.title}</div>
                <div class="notification-message">${n.message}</div>
                <div class="notification-time">${n.time}</div>
            </div>
        `).join('');
    }
    
    function updateNotificationBadge() {
        const unreadCount = notifications.filter(n => !n.read).length;
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = 'flex';
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            } else {
                badge.style.display = 'none';
            }
        }
    }
    
    window.markNotificationRead = function(id) {
        const notification = notifications.find(n => n.id == id);
        if (notification) {
            notification.read = true;
            saveNotifications();
            updateNotificationUI();
            updateNotificationBadge();
        }
    };
    
    function saveNotifications() {
        localStorage.setItem('et_notifications', JSON.stringify(notifications));
    }
    
    function loadNotifications() {
        const saved = localStorage.getItem('et_notifications');
        if (saved) notifications = JSON.parse(saved);
    }
    
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
    
    // Check budget alerts and send notifications
    function checkBudgetAlerts() {
        const currentMonth = getCurrentMonth();
        let totalExpense = 0;
        const categorySpending = {};
        
        for (let t of transactions) {
            if (t.type === 'expense' && t.date.startsWith(currentMonth)) {
                totalExpense += t.amount;
                categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount;
            }
        }
        
        // Total budget alert
        if (totalBudget > 0 && totalExpense > totalBudget) {
            addNotification('⚠️ Budget Alert', `You have exceeded your monthly budget by ${formatAmount(totalExpense - totalBudget)}`, 'warning');
        } else if (totalBudget > 0 && totalExpense > totalBudget * 0.8) {
            addNotification('⚠️ Budget Warning', `You have used ${Math.round((totalExpense/totalBudget)*100)}% of your monthly budget`, 'warning');
        }
        
        // Category budget alerts
        for (let [cat, budget] of Object.entries(categoryBudgets)) {
            const spent = categorySpending[cat] || 0;
            if (spent > budget) {
                addNotification(`📊 Category Alert`, `${cat} budget exceeded by ${formatAmount(spent - budget)}`, 'warning');
            } else if (spent > budget * 0.8) {
                addNotification(`📊 Category Warning`, `${cat} is at ${Math.round((spent/budget)*100)}% of budget`, 'info');
            }
        }
    }
    
    // Daily limit check
    function checkDailyLimit() {
        if (dailyLimit <= 0) return;
        
        const today = getToday();
        let todayExpense = 0;
        for (let t of transactions) {
            if (t.type === 'expense' && t.date === today) {
                todayExpense += t.amount;
            }
        }
        
        if (todayExpense > dailyLimit) {
            addNotification('📅 Daily Limit Alert', `Today's spending (${formatAmount(todayExpense)}) exceeded daily limit of ${formatAmount(dailyLimit)}`, 'warning');
        } else if (todayExpense > dailyLimit * 0.8) {
            addNotification('📅 Daily Limit Warning', `Today's spending is at ${Math.round((todayExpense/dailyLimit)*100)}% of daily limit`, 'info');
        }
        
        // Update progress bar
        const dailyProgress = document.getElementById('dailyProgress');
        if (dailyProgress) {
            const percent = Math.min((todayExpense / dailyLimit) * 100, 100);
            dailyProgress.style.width = percent + '%';
        }
        const dailyLimitInfo = document.getElementById('dailyLimitInfo');
        if (dailyLimitInfo) {
            dailyLimitInfo.innerHTML = `Today: ${formatAmount(todayExpense)} / ${formatAmount(dailyLimit)}`;
        }
    }

    // ============ REAL CHARTS ============
    function updateWeeklyTrendChart() {
        const ctx = document.getElementById('weeklyTrendChart')?.getContext('2d');
        if (!ctx) return;
        
        const trends = [];
        const labels = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = formatDate(d);
            let dailyExpense = 0;
            for (let t of transactions) {
                if (t.type === 'expense' && t.date === dateStr) dailyExpense += t.amount;
            }
            trends.push(dailyExpense / currencies[currentCurrency].rate);
            labels.push(d.getDate() + '/' + (d.getMonth()+1));
        }
        
        if (weeklyTrendChart) weeklyTrendChart.destroy();
        
        weeklyTrendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Expenses',
                    data: trends,
                    backgroundColor: 'rgba(52, 152, 219, 0.7)',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => `${currencies[currentCurrency].symbol}${context.raw.toFixed(2)}`
                        }
                    }
                }
            }
        });
    }
    
    function updateIncomeExpenseBarChart() {
        const ctx = document.getElementById('incomeExpenseBarChart')?.getContext('2d');
        if (!ctx) return;
        
        let totalIncome = 0, totalExpense = 0;
        for (let t of transactions) {
            if (t.type === 'income') totalIncome += t.amount;
            else totalExpense += t.amount;
        }
        
        totalIncome = totalIncome / currencies[currentCurrency].rate;
        totalExpense = totalExpense / currencies[currentCurrency].rate;
        
        if (incomeExpenseBarChart) incomeExpenseBarChart.destroy();
        
        incomeExpenseBarChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Income', 'Expense'],
                datasets: [{
                    label: 'Amount',
                    data: [totalIncome, totalExpense],
                    backgroundColor: ['rgba(46, 204, 113, 0.7)', 'rgba(231, 76, 60, 0.7)'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => `${currencies[currentCurrency].symbol}${context.raw.toFixed(2)}`
                        }
                    }
                }
            }
        });
    }
    
    function updateExpensePieChart() {
        const ctx = document.getElementById('expensePieChart')?.getContext('2d');
        if (!ctx) return;
        
        const currentMonth = getCurrentMonth();
        const categoryTotals = {};
        
        for (let t of transactions) {
            if (t.type === 'expense' && t.date.startsWith(currentMonth)) {
                categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
            }
        }
        
        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals).map(v => v / currencies[currentCurrency].rate);
        const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#66FF99', '#FF66B2', '#99CCFF'];
        
        if (expensePieChart) expensePieChart.destroy();
        
        if (labels.length === 0) {
            ctx.canvas.parentElement.innerHTML = '<div class="empty-state">No expense data this month</div>';
            const newCanvas = document.createElement('canvas');
            newCanvas.id = 'expensePieChart';
            newCanvas.style.maxHeight = '300px';
            newCanvas.style.width = '100%';
            ctx.canvas.parentElement.appendChild(newCanvas);
            return;
        }
        
        expensePieChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${currencies[currentCurrency].symbol}${context.raw.toFixed(2)}`
                        }
                    }
                }
            }
        });
    }
    
    function updateMonthlyTrendChart() {
        const ctx = document.getElementById('monthlyTrendChart')?.getContext('2d');
        if (!ctx) return;
        
        const monthlyData = {};
        const now = new Date();
        
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            monthlyData[monthKey] = { income: 0, expense: 0, label: d.toLocaleDateString('en-US', { month: 'short' }) };
        }
        
        for (let t of transactions) {
            const monthKey = t.date.slice(0, 7);
            if (monthlyData[monthKey]) {
                if (t.type === 'income') monthlyData[monthKey].income += t.amount;
                else monthlyData[monthKey].expense += t.amount;
            }
        }
        
        const labels = Object.values(monthlyData).map(m => m.label);
        const incomeData = Object.values(monthlyData).map(m => m.income / currencies[currentCurrency].rate);
        const expenseData = Object.values(monthlyData).map(m => m.expense / currencies[currentCurrency].rate);
        
        if (monthlyTrendChart) monthlyTrendChart.destroy();
        
        monthlyTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        borderColor: '#2ecc71',
                        backgroundColor: 'rgba(46, 204, 113, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Expense',
                        data: expenseData,
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${currencies[currentCurrency].symbol}${context.raw.toFixed(2)}`
                        }
                    }
                }
            }
        });
    }
    
    function updateAllCharts() {
        updateWeeklyTrendChart();
        updateIncomeExpenseBarChart();
        updateExpensePieChart();
        updateMonthlyTrendChart();
    }

    // Load/Save functions
    function loadData() {
        try {
            transactions = JSON.parse(localStorage.getItem('et_transactions')) || [];
            goals = JSON.parse(localStorage.getItem('et_goals')) || [];
            recurringExpenses = JSON.parse(localStorage.getItem('et_recurring')) || [];
            categoryBudgets = JSON.parse(localStorage.getItem('et_category_budgets')) || {};
            totalBudget = parseFloat(localStorage.getItem('et_total_budget')) || 0;
            dailyLimit = parseFloat(localStorage.getItem('et_daily_limit')) || 0;
            defaultPaymentMethod = localStorage.getItem('et_default_payment') || "Cash";
            currentCurrency = localStorage.getItem('et_currency') || "INR";
            notificationsEnabled = localStorage.getItem('et_notifications_enabled') !== 'false';
            const savedQuickItems = localStorage.getItem('et_quick_items');
            if (savedQuickItems) quickAddItems = JSON.parse(savedQuickItems);
            
            document.getElementById('defaultPaymentMethod').value = defaultPaymentMethod;
            document.getElementById('dailyLimitSetting').value = dailyLimit;
            document.getElementById('enableNotifications').checked = notificationsEnabled;
        } catch(e) { console.error(e); }
    }

    function saveData() {
        localStorage.setItem('et_transactions', JSON.stringify(transactions));
        localStorage.setItem('et_goals', JSON.stringify(goals));
        localStorage.setItem('et_recurring', JSON.stringify(recurringExpenses));
        localStorage.setItem('et_category_budgets', JSON.stringify(categoryBudgets));
        localStorage.setItem('et_total_budget', totalBudget);
        localStorage.setItem('et_daily_limit', dailyLimit);
        localStorage.setItem('et_default_payment', defaultPaymentMethod);
        localStorage.setItem('et_currency', currentCurrency);
        localStorage.setItem('et_quick_items', JSON.stringify(quickAddItems));
        localStorage.setItem('et_notifications_enabled', notificationsEnabled);
    }

    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function formatDate(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function getToday() {
        return formatDate(new Date());
    }

    function getCurrentMonth() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    // Quick Add Functions
    function setupQuickAdd() {
        const container = document.getElementById('quickAddGrid');
        if (!container) return;
        let html = '';
        quickAddItems.forEach((item, index) => {
            html += `
                <div class="quick-add-item" onclick="quickAdd(${index})">
                    <button class="quick-edit-btn" onclick="event.stopPropagation(); editQuickItem(${index})">✏️</button>
                    <div class="quick-amount">${formatAmount(item.amount)}</div>
                    <div class="quick-category">${item.icon} ${item.category}</div>
                </div>
            `;
        });
        html += `
            <div class="quick-add-item add-quick-btn" onclick="addNewQuickItem()">
                <div class="quick-amount">➕</div>
                <div class="quick-category">Add Custom</div>
            </div>
        `;
        container.innerHTML = html;
    }

    window.quickAdd = function(index) {
        const item = quickAddItems[index];
        if (item) {
            document.getElementById('transCategory').value = item.category;
            document.getElementById('transAmount').value = item.amount;
            document.getElementById('transType').value = 'expense';
            document.getElementById('transDate').value = getToday();
            showToast(`Quick add ${formatAmount(item.amount)} to ${item.category}`);
        }
    };

    window.editQuickItem = function(index) {
        currentEditingQuickIndex = index;
        const item = quickAddItems[index];
        document.getElementById('quickModalTitle').innerHTML = 'Edit Quick Add';
        document.getElementById('quickEditCategory').value = item.category;
        document.getElementById('quickEditAmount').value = item.amount;
        document.getElementById('quickEditIcon').value = item.icon;
        document.getElementById('quickEditModal').classList.add('show');
    };

    window.addNewQuickItem = function() {
        currentEditingQuickIndex = -1;
        document.getElementById('quickModalTitle').innerHTML = 'Add New Quick Add';
        document.getElementById('quickEditCategory').value = '';
        document.getElementById('quickEditAmount').value = '';
        document.getElementById('quickEditIcon').value = '📌';
        document.getElementById('quickEditModal').classList.add('show');
    };

    window.closeQuickModal = function() {
        document.getElementById('quickEditModal').classList.remove('show');
        currentEditingQuickIndex = -1;
    };

    document.getElementById('quickEditForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const category = document.getElementById('quickEditCategory').value.trim();
        const amount = parseFloat(document.getElementById('quickEditAmount').value);
        const icon = document.getElementById('quickEditIcon').value.trim() || '📌';
        
        if (!category || isNaN(amount) || amount <= 0) {
            showToast('Please enter valid category and amount');
            return;
        }
        
        if (currentEditingQuickIndex >= 0) {
            quickAddItems[currentEditingQuickIndex] = { category, amount, icon };
            showToast('Quick add updated!');
        } else {
            quickAddItems.push({ category, amount, icon });
            showToast('New quick add created!');
        }
        saveData();
        setupQuickAdd();
        closeQuickModal();
    });

    document.getElementById('deleteQuickBtn')?.addEventListener('click', function() {
        if (currentEditingQuickIndex >= 0 && quickAddItems.length > 1) {
            if (confirm('Delete this quick add item?')) {
                quickAddItems.splice(currentEditingQuickIndex, 1);
                saveData();
                setupQuickAdd();
                closeQuickModal();
                showToast('Quick add deleted');
            }
        } else if (quickAddItems.length <= 1) {
            showToast('Cannot delete last quick add item');
        } else {
            showToast('Select an item to delete');
        }
    });

    // Download Functions
    async function generatePDF(element, filename) {
        const opt = {
            margin: [0.5, 0.5, 0.5, 0.5],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        try {
            await html2pdf().set(opt).from(element).save();
            showToast('✓ PDF downloaded!');
        } catch(e) { showToast('Error generating PDF'); }
    }

    function downloadCSV(transactionsData, filename) {
        let csv = 'Date,Type,Category,Description,Amount(INR),PaymentMethod\n';
        for (let t of transactionsData) {
            csv += `"${t.date}","${t.type}","${t.category}","${t.description || '-'}",${t.amount},"${t.paymentMethod || 'Cash'}"\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`✓ Downloaded ${filename}`);
    }

    function downloadMonthCSV() {
        const monthStr = currentTransactionMonth.getFullYear() + '-' + String(currentTransactionMonth.getMonth() + 1).padStart(2, '0');
        const monthTransactions = transactions.filter(t => t.date.startsWith(monthStr));
        if (monthTransactions.length === 0) {
            showToast('No transactions this month');
            return;
        }
        downloadCSV(monthTransactions, `transactions_${monthStr}.csv`);
    }

    async function downloadMonthPDF() {
        const monthStr = currentTransactionMonth.getFullYear() + '-' + String(currentTransactionMonth.getMonth() + 1).padStart(2, '0');
        const monthTransactions = transactions.filter(t => t.date.startsWith(monthStr));
        if (monthTransactions.length === 0) {
            showToast('No transactions this month');
            return;
        }
        
        let totalIncome = 0, totalExpense = 0;
        for (let t of monthTransactions) {
            if (t.type === 'income') totalIncome += t.amount;
            else totalExpense += t.amount;
        }
        
        const reportHTML = `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
                <h1 style="color: #667eea; text-align: center;">Expense Tracker Report</h1>
                <p style="text-align: center; color: #666;">${currentTransactionMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                <hr>
                <div style="display: flex; gap: 20px; margin: 20px 0;">
                    <div style="flex:1; background:#d1fae5; padding:15px; border-radius:12px;"><strong>Total Income</strong><br>${formatAmount(totalIncome)}</div>
                    <div style="flex:1; background:#fee2e2; padding:15px; border-radius:12px;"><strong>Total Expense</strong><br>${formatAmount(totalExpense)}</div>
                </div>
                <h2>Transactions</h2>
                <table style="width:100%; border-collapse: collapse;">
                    <tr style="background:#f0f2f5;"><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr>
                    ${monthTransactions.map(t => `<tr><td>${t.date}</td><td>${t.category}</td><td>${t.description || '-'}</td><td style="color:${t.type === 'income' ? '#10b981' : '#ef4444'}">${t.type === 'income' ? '+' : '-'} ${formatAmount(t.amount)}</td><tr>`).join('')}
                </table>
                <p style="text-align: center; margin-top: 30px; color:#999;">Generated by Expense Tracker Pro</p>
            </div>
        `;
        const element = document.createElement('div');
        element.innerHTML = reportHTML;
        document.body.appendChild(element);
        await generatePDF(element, `expense_report_${monthStr}.pdf`);
        document.body.removeChild(element);
    }

    function downloadAllCSV() {
        if (transactions.length === 0) {
            showToast('No transactions to export');
            return;
        }
        downloadCSV(transactions, `all_transactions_${getToday()}.csv`);
    }

    async function downloadAllPDF() {
        if (transactions.length === 0) {
            showToast('No transactions to export');
            return;
        }
        
        let totalIncome = 0, totalExpense = 0;
        for (let t of transactions) {
            if (t.type === 'income') totalIncome += t.amount;
            else totalExpense += t.amount;
        }
        
        const reportHTML = `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
                <h1 style="color: #667eea; text-align: center;">Expense Tracker - Complete History</h1>
                <p style="text-align: center; color: #666;">Generated on: ${new Date().toLocaleString()}</p>
                <hr>
                <div style="display: flex; gap: 20px; margin: 20px 0;">
                    <div style="flex:1; background:#d1fae5; padding:15px; border-radius:12px;"><strong>Total Income</strong><br>${formatAmount(totalIncome)}</div>
                    <div style="flex:1; background:#fee2e2; padding:15px; border-radius:12px;"><strong>Total Expense</strong><br>${formatAmount(totalExpense)}</div>
                    <div style="flex:1; background:#e0e7ff; padding:15px; border-radius:12px;"><strong>Balance</strong><br>${formatAmount(totalIncome - totalExpense)}</div>
                </div>
                <h2>All Transactions (${transactions.length})</h2>
                <table style="width:100%; border-collapse: collapse;">
                    <tr style="background:#f0f2f5;"><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Payment</th><th>Amount</th></tr>
                    ${transactions.map(t => `<tr><td>${t.date}</td><td>${t.type}</td><td>${t.category}</td><td>${t.description || '-'}</td><td>${t.paymentMethod || 'Cash'}</td><td style="color:${t.type === 'income' ? '#10b981' : '#ef4444'}">${t.type === 'income' ? '+' : '-'} ${formatAmount(t.amount)}</td></tr>`).join('')}
                </table>
                <p style="text-align: center; margin-top: 30px; color:#999;">Expense Tracker Pro - Created by Meraj Mohi Uddin</p>
            </div>
        `;
        const element = document.createElement('div');
        element.innerHTML = reportHTML;
        document.body.appendChild(element);
        await generatePDF(element, `all_transactions_${getToday()}.pdf`);
        document.body.removeChild(element);
    }

    // Core Functions
    function processRecurringExpenses() {
        const today = new Date();
        const currentMonth = formatDate(today).slice(0, 7);
        let addedCount = 0;
        for (let i = 0; i < recurringExpenses.length; i++) {
            const rec = recurringExpenses[i];
            let shouldAdd = false;
            if (rec.frequency === 'monthly' && (!rec.lastAdded || rec.lastAdded !== currentMonth)) shouldAdd = true;
            else if (rec.frequency === 'weekly') {
                const lastWeek = new Date(rec.lastAdded);
                const daysDiff = (today - lastWeek) / (1000 * 60 * 60 * 24);
                if (!rec.lastAdded || daysDiff >= 7) shouldAdd = true;
            } else if (rec.frequency === 'yearly' && (!rec.lastAdded || rec.lastAdded.slice(0,4) !== currentMonth.slice(0,4))) shouldAdd = true;
            
            if (shouldAdd) {
                const alreadyExists = transactions.some(t => t.date.slice(0,7) === currentMonth && t.category === rec.category && t.description === rec.description);
                if (!alreadyExists) {
                    transactions.push({
                        id: Date.now() + Math.random() + i,
                        date: formatDate(today),
                        type: 'expense',
                        category: rec.category,
                        amount: rec.amount,
                        description: rec.description + ' (' + rec.frequency + ')',
                        paymentMethod: rec.paymentMethod || 'Cash',
                        timestamp: new Date().toISOString()
                    });
                    rec.lastAdded = formatDate(today);
                    addedCount++;
                    addNotification('🔄 Recurring Bill Added', `${rec.category}: ${formatAmount(rec.amount)} (${rec.frequency})`, 'info');
                }
            }
        }
        if (addedCount > 0) { saveData(); showToast('✓ Added ' + addedCount + ' recurring expenses'); }
    }

    window.deleteTransaction = function(id) {
        if (confirm('Delete this transaction?')) {
            transactions = transactions.filter(t => t.id != id);
            saveData();
            updateAllPages();
            showToast('✓ Transaction deleted');
        }
    };

    function addTransaction(e) {
        e.preventDefault();
        const date = document.getElementById('transDate').value;
        const type = document.getElementById('transType').value;
        const category = document.getElementById('transCategory').value;
        const amountInCurrent = parseFloat(document.getElementById('transAmount').value);
        const description = document.getElementById('transDesc').value;
        const paymentMethod = document.getElementById('transPaymentMethod').value;
        if (!date || isNaN(amountInCurrent) || amountInCurrent <= 0) { showToast('Please fill all fields'); return; }
        const amountInINR = amountInCurrent * currencies[currentCurrency].rate;
        transactions.unshift({ id: Date.now() + Math.random(), date, type, category, amount: amountInINR, description: description || '', paymentMethod, timestamp: new Date().toISOString() });
        saveData();
        updateAllPages();
        document.getElementById('transAmount').value = '';
        document.getElementById('transDesc').value = '';
        showToast('✓ Transaction added!');
        
        // Send notification for large expenses
        if (type === 'expense' && amountInINR > 5000 / currencies[currentCurrency].rate) {
            addNotification('💰 Large Expense Alert', `You spent ${formatAmount(amountInINR)} on ${category}`, 'warning');
        }
        
        checkBudgetAlerts();
        checkDailyLimit();
    }

    function updateDashboard() {
        const currentMonth = getCurrentMonth();
        let totalIncome = 0, totalExpense = 0;
        for (let t of transactions) { if (t.type === 'income') totalIncome += t.amount; else totalExpense += t.amount; }
        const balance = totalIncome - totalExpense;
        const savingsRate = totalIncome > 0 ? ((balance / totalIncome) * 100) : 0;
        document.getElementById('dashTotalIncome').innerHTML = formatAmount(totalIncome);
        document.getElementById('dashTotalExpense').innerHTML = formatAmount(totalExpense);
        document.getElementById('dashBalance').innerHTML = formatAmount(balance);
        document.getElementById('dashSavingsRate').innerHTML = savingsRate.toFixed(1) + '%';
        
        // Top categories
        const categories = {};
        for (let t of transactions) { if (t.type === 'expense' && t.date.startsWith(currentMonth)) categories[t.category] = (categories[t.category] || 0) + t.amount; }
        const sorted = Object.entries(categories).sort((a,b) => b[1] - a[1]).slice(0, 5);
        document.getElementById('topCategoriesList').innerHTML = sorted.map(([cat, amt]) => `<div><div style="display:flex;justify-content:space-between"><span>${cat}</span><span>${formatAmount(amt)}</span></div><div class="progress-bar"><div class="progress-fill" style="width: ${(amt / (totalExpense||1)) * 100}%"></div></div></div>`).join('') || '<div class="empty-state">No expenses this month</div>';
        
        // Alerts
        document.getElementById('budgetAlerts').innerHTML = (totalBudget > 0 && totalExpense > totalBudget) ? `<div class="warning-note">⚠️ Budget exceeded by ${formatAmount(totalExpense - totalBudget)}</div>` : '<div class="empty-state">✅ No alerts</div>';
        document.getElementById('upcomingRecurring').innerHTML = recurringExpenses.length ? recurringExpenses.slice(0,3).map(r => `<div>${r.category}: ${formatAmount(r.amount)} (${r.frequency})</div>`).join('') : '<div class="empty-state">No recurring expenses</div>';
        
        updateWeeklyTrendChart();
    }

    function updateTransactionsList() {
        const monthStr = currentTransactionMonth.getFullYear() + '-' + String(currentTransactionMonth.getMonth() + 1).padStart(2, '0');
        document.getElementById('transactionMonth').innerHTML = currentTransactionMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        let filtered = transactions.filter(t => t.date.startsWith(monthStr));
        if (filterType !== 'all') filtered = filtered.filter(t => t.type === filterType);
        if (filterCategory !== 'all') filtered = filtered.filter(t => t.category === filterCategory);
        if (filterPaymentMethod !== 'all') filtered = filtered.filter(t => t.paymentMethod === filterPaymentMethod);
        if (filterDateFrom) filtered = filtered.filter(t => t.date >= filterDateFrom);
        if (filterDateTo) filtered = filtered.filter(t => t.date <= filterDateTo);
        if (searchQuery) filtered = filtered.filter(t => t.category.toLowerCase().includes(searchQuery.toLowerCase()) || (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase())));
        if (sortBy === 'date_desc') filtered.sort((a,b) => b.date.localeCompare(a.date));
        else if (sortBy === 'date_asc') filtered.sort((a,b) => a.date.localeCompare(b.date));
        else if (sortBy === 'amount_desc') filtered.sort((a,b) => b.amount - a.amount);
        else if (sortBy === 'amount_asc') filtered.sort((a,b) => a.amount - b.amount);
        document.getElementById('transactionCount').innerHTML = `(${filtered.length})`;
        const container = document.getElementById('filteredTransactionsList');
        if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">📭 No transactions found</div>'; return; }
        const icons = { 'Food & Dining':'🍔','Groceries':'🛒','Transport':'🚗','Rent':'🏠','Utilities':'💡','Entertainment':'🎬','Shopping':'🛍️','Healthcare':'🏥','Salary':'💼','Other':'📌' };
        container.innerHTML = filtered.map(t => `<div class="transaction-item"><div class="transaction-info"><div class="category-icon">${icons[t.category] || '📌'}</div><div class="transaction-details"><div class="transaction-category">${t.category}</div><div class="transaction-desc">${t.description || '-'} • ${t.paymentMethod || 'Cash'}</div><div class="transaction-date">${t.date}</div></div></div><div class="transaction-amount ${t.type}">${t.type === 'income' ? '+' : '-'} ${formatAmount(t.amount)}</div><button class="delete-btn" onclick="deleteTransaction('${t.id}')">🗑️</button></div>`).join('');
    }

    function updateBudgetsPage() {
        const currentMonth = getCurrentMonth();
        let categorySpending = {};
        for (let t of transactions) { if (t.type === 'expense' && t.date.startsWith(currentMonth)) categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount; }
        const container = document.getElementById('categoryBudgetsList');
        let html = '';
        for (let cat in categoryBudgets) {
            const spent = categorySpending[cat] || 0;
            const budget = categoryBudgets[cat];
            const percent = (spent / budget) * 100;
            html += `<div><div style="display:flex;justify-content:space-between"><strong>${cat}</strong><span>${formatAmount(spent)} / ${formatAmount(budget)}</span></div><div class="progress-bar"><div class="progress-fill ${spent > budget ? 'warning' : ''}" style="width: ${Math.min(percent,100)}%"></div></div></div>`;
        }
        container.innerHTML = html || '<div class="empty-state">No category budgets</div>';
        const totalBudgetEl = document.getElementById('totalBudget');
        if (totalBudgetEl) totalBudgetEl.value = totalBudget / currencies[currentCurrency].rate || '';
        
        checkDailyLimit();
    }

    function setTotalBudget() {
        const budgetInCurrent = parseFloat(document.getElementById('totalBudget').value);
        if (isNaN(budgetInCurrent) || budgetInCurrent <= 0) return;
        totalBudget = budgetInCurrent * currencies[currentCurrency].rate;
        saveData();
        updateAllPages();
        showToast('✓ Budget set');
        checkBudgetAlerts();
    }

    function addCategoryBudget() {
        const cat = prompt('Category name:');
        if (!cat) return;
        const budgetInCurrent = parseFloat(prompt('Budget amount:'));
        if (isNaN(budgetInCurrent) || budgetInCurrent <= 0) return;
        categoryBudgets[cat] = budgetInCurrent * currencies[currentCurrency].rate;
        saveData();
        updateBudgetsPage();
        showToast('✓ Budget set');
        checkBudgetAlerts();
    }

    function updateInsights() {
        updateIncomeExpenseBarChart();
        updateExpensePieChart();
        updateMonthlyTrendChart();
        
        let totalSaved = 0;
        for (let t of transactions) { if (t.type === 'income') totalSaved += t.amount; else totalSaved -= t.amount; }
        document.getElementById('savingsGoalProgress').innerHTML = `<div class="stat-card"><div>Total Savings</div><div class="stat-value savings">${formatAmount(totalSaved)}</div></div>`;
    }

    function updateGoalsSimple() {
        const container = document.getElementById('goalsListSimple');
        if (goals.length === 0) { container.innerHTML = '<div class="empty-state">No goals yet</div>'; return; }
        container.innerHTML = goals.map((g, i) => `<div><strong>${g.name}</strong>: ${formatAmount(g.current)} / ${formatAmount(g.target)} (${((g.current/g.target)*100).toFixed(1)}%)<br><input type="number" id="goalAmt_${i}" placeholder="Add amount"><button onclick="addToGoal(${i})">+</button><button onclick="deleteGoal(${i})">Delete</button></div>`).join('');
    }

    window.addToGoal = function(i) {
        const input = document.getElementById('goalAmt_' + i);
        const amt = parseFloat(input.value);
        if (isNaN(amt) || amt <= 0) return;
        goals[i].current += amt * currencies[currentCurrency].rate;
        saveData();
        updateGoalsSimple();
        showToast('✓ Added to goal');
        input.value = '';
        
        // Goal progress notification
        const progress = (goals[i].current / goals[i].target) * 100;
        if (progress >= 100) {
            addNotification('🎉 Goal Achieved!', `Congratulations! You reached your goal: ${goals[i].name}`, 'success');
        } else if (progress >= 75 && progress < 80) {
            addNotification('🎯 Goal Progress', `${goals[i].name} is at ${Math.round(progress)}%! Almost there!`, 'info');
        }
    };
    
    window.deleteGoal = function(i) { if (confirm('Delete goal?')) { goals.splice(i,1); saveData(); updateGoalsSimple(); } };

    function createGoalSimple() {
        const name = document.getElementById('goalNameSimple').value.trim();
        const target = parseFloat(document.getElementById('goalTargetSimple').value);
        if (!name || isNaN(target) || target <= 0) { showToast('Enter valid goal'); return; }
        goals.push({ name, target: target * currencies[currentCurrency].rate, current: 0, deadline: document.getElementById('goalDeadline').value || null });
        saveData();
        updateGoalsSimple();
        document.getElementById('goalNameSimple').value = '';
        document.getElementById('goalTargetSimple').value = '';
        document.getElementById('goalDeadline').value = '';
        showToast('✓ Goal created');
        addNotification('🎯 New Goal Created', `Start saving for: ${name} (${formatAmount(target)})`, 'info');
    }

    function updateRecurringList() {
        const container = document.getElementById('recurringList');
        if (recurringExpenses.length === 0) { container.innerHTML = '<div class="empty-state">No recurring expenses</div>'; return; }
        container.innerHTML = recurringExpenses.map((r, i) => `<div><strong>${r.category}</strong> - ${formatAmount(r.amount)} (${r.frequency}) <button onclick="deleteRecurring(${i})">Delete</button></div>`).join('');
    }
    
    window.deleteRecurring = function(i) { recurringExpenses.splice(i,1); saveData(); updateRecurringList(); showToast('Deleted'); };
    
    function addRecurringExpense() {
        const category = prompt('Category:'); if (!category) return;
        const description = prompt('Description:'); if (!description) return;
        const amount = parseFloat(prompt('Amount:')); if (isNaN(amount) || amount <= 0) return;
        const frequency = prompt('Frequency (weekly/monthly/yearly):', 'monthly'); if (!frequency) return;
        recurringExpenses.push({ category, description, amount: amount * currencies[currentCurrency].rate, frequency: frequency.toLowerCase(), lastAdded: null, paymentMethod: defaultPaymentMethod });
        saveData(); updateRecurringList(); showToast('✓ Recurring added');
        addNotification('🔄 Recurring Bill Added', `${category}: ${formatAmount(amount)} (${frequency})`, 'info');
    }

    function fullBackup() { copyToClipboard(JSON.stringify({ transactions, goals, recurringExpenses, categoryBudgets, totalBudget, dailyLimit, defaultPaymentMethod, currency: currentCurrency, quickAddItems, notifications }, null, 2), '✓ Backup copied!'); }
    
    function restoreFromClipboard() { 
        const jsonStr = prompt('Paste your backup JSON:'); 
        if (!jsonStr) return; 
        try { 
            const backup = JSON.parse(jsonStr); 
            transactions = backup.transactions || []; 
            goals = backup.goals || []; 
            recurringExpenses = backup.recurringExpenses || []; 
            categoryBudgets = backup.categoryBudgets || {}; 
            totalBudget = backup.totalBudget || 0; 
            dailyLimit = backup.dailyLimit || 0; 
            defaultPaymentMethod = backup.defaultPaymentMethod || 'Cash'; 
            currentCurrency = backup.currency || 'INR'; 
            if (backup.quickAddItems) quickAddItems = backup.quickAddItems; 
            if (backup.notifications) notifications = backup.notifications;
            saveData(); 
            updateAllPages(); 
            showToast('✓ Restored!'); 
        } catch(e) { showToast('Invalid backup'); } 
    }
    
    function exportAllCSV() { downloadCSV(transactions, `all_transactions_${getToday()}.csv`); }
    
    function resetAllData() { 
        if (confirm('⚠️ DELETE ALL DATA?')) { 
            transactions = []; 
            goals = []; 
            recurringExpenses = []; 
            categoryBudgets = {}; 
            totalBudget = 0; 
            dailyLimit = 0; 
            notifications = [];
            quickAddItems = [{ category: "Groceries", amount: 500, icon: "🛒" },{ category: "Food & Dining", amount: 300, icon: "🍔" },{ category: "Transport", amount: 100, icon: "🚗" },{ category: "Shopping", amount: 200, icon: "🛍️" }]; 
            saveData(); 
            updateAllPages(); 
            showToast('All data reset'); 
        } 
    }
    
    function saveSettings() { 
        defaultPaymentMethod = document.getElementById('defaultPaymentMethod').value; 
        dailyLimit = parseFloat(document.getElementById('dailyLimitSetting').value) || 0; 
        notificationsEnabled = document.getElementById('enableNotifications').checked;
        localStorage.setItem('et_default_payment', defaultPaymentMethod); 
        localStorage.setItem('et_daily_limit', dailyLimit); 
        localStorage.setItem('et_notifications_enabled', notificationsEnabled);
        showToast('Settings saved'); 
        if (dailyLimit > 0) checkDailyLimit();
    }
    
    function copyToClipboard(text, msg) { 
        if (navigator.clipboard && navigator.clipboard.writeText) 
            navigator.clipboard.writeText(text).then(() => showToast(msg)); 
        else { 
            const ta = document.createElement('textarea'); 
            ta.value = text; 
            document.body.appendChild(ta); 
            ta.select(); 
            document.execCommand('copy'); 
            document.body.removeChild(ta); 
            showToast(msg); 
        } 
    }

    function buildCurrencyMenu() {
        const menu = document.getElementById('currencyMenu');
        menu.innerHTML = Object.entries(currencies).map(([code, data]) => `<div class="currency-option" data-currency="${code}">${code} - ${data.name}</div>`).join('');
        document.querySelectorAll('.currency-option').forEach(opt => opt.addEventListener('click', function() { 
            currentCurrency = this.getAttribute('data-currency'); 
            localStorage.setItem('et_currency', currentCurrency); 
            document.getElementById('currencyMenu').classList.remove('show'); 
            updateAllPages(); 
            showToast(`Currency: ${currentCurrency}`); 
        }));
    }

    function setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', function() {
                const pageId = this.getAttribute('data-page');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById(pageId).classList.add('active');
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                this.classList.add('active');
                if (pageId === 'dashboard') updateDashboard();
                if (pageId === 'transactions') updateTransactionsList();
                if (pageId === 'budgets') updateBudgetsPage();
                if (pageId === 'insights') updateInsights();
                if (pageId === 'add') setupQuickAdd();
            });
        });
    }

    function initCategoryFilter() {
        const categories = ['Food & Dining','Groceries','Transport','Rent','Utilities','Entertainment','Shopping','Healthcare','Salary','Other'];
        const select = document.getElementById('filterCategory');
        select.innerHTML = '<option value="all">All Categories</option>';
        categories.forEach(c => select.innerHTML += `<option value="${c}">${c}</option>`);
    }

    function initDarkMode() {
        const saved = localStorage.getItem('et_dark_mode');
        if (saved === 'true') document.body.classList.add('dark');
        document.getElementById('themeToggle').addEventListener('click', function() {
            document.body.classList.toggle('dark');
            localStorage.setItem('et_dark_mode', document.body.classList.contains('dark'));
            this.innerHTML = document.body.classList.contains('dark') ? '☀️' : '🌙';
        });
    }
    
    // Notification panel toggle
    function initNotificationPanel() {
        const bell = document.getElementById('notificationBell');
        const panel = document.getElementById('notificationPanel');
        
        bell?.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('show');
        });
        
        document.addEventListener('click', () => {
            panel.classList.remove('show');
        });
        
        document.getElementById('clearNotificationsBtn')?.addEventListener('click', () => {
            notifications = [];
            saveNotifications();
            updateNotificationUI();
            updateNotificationBadge();
            showToast('All notifications cleared');
        });
    }

    function updateAllPages() {
        updateDashboard(); 
        updateTransactionsList(); 
        updateBudgetsPage(); 
        updateInsights(); 
        updateGoalsSimple(); 
        updateRecurringList(); 
        setupQuickAdd();
        updateNotificationUI();
        updateNotificationBadge();
        document.getElementById('currentCurrencyCode').innerHTML = currentCurrency;
    }

    // Event listeners
    document.getElementById('currencySelector')?.addEventListener('click', (e) => { document.getElementById('currencyMenu').classList.toggle('show'); e.stopPropagation(); });
    document.addEventListener('click', () => document.getElementById('currencyMenu').classList.remove('show'));
    document.getElementById('transactionForm')?.addEventListener('submit', addTransaction);
    document.getElementById('setBudgetBtn')?.addEventListener('click', setTotalBudget);
    document.getElementById('addCategoryBudgetBtn')?.addEventListener('click', addCategoryBudget);
    document.getElementById('addRecurringBtn')?.addEventListener('click', addRecurringExpense);
    document.getElementById('createGoalSimpleBtn')?.addEventListener('click', createGoalSimple);
    document.getElementById('backupBtn')?.addEventListener('click', fullBackup);
    document.getElementById('restoreBtn')?.addEventListener('click', restoreFromClipboard);
    document.getElementById('exportAllCSVBtn')?.addEventListener('click', exportAllCSV);
    document.getElementById('resetAllDataBtn')?.addEventListener('click', resetAllData);
    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);
    document.getElementById('searchInput')?.addEventListener('input', (e) => { searchQuery = e.target.value; updateTransactionsList(); });
    document.getElementById('filterType')?.addEventListener('change', (e) => { filterType = e.target.value; updateTransactionsList(); });
    document.getElementById('filterCategory')?.addEventListener('change', (e) => { filterCategory = e.target.value; updateTransactionsList(); });
    document.getElementById('filterPaymentMethod')?.addEventListener('change', (e) => { filterPaymentMethod = e.target.value; updateTransactionsList(); });
    document.getElementById('filterDateFrom')?.addEventListener('change', (e) => { filterDateFrom = e.target.value; updateTransactionsList(); });
    document.getElementById('filterDateTo')?.addEventListener('change', (e) => { filterDateTo = e.target.value; updateTransactionsList(); });
    document.getElementById('sortBy')?.addEventListener('change', (e) => { sortBy = e.target.value; updateTransactionsList(); });
    document.getElementById('prevTransactionMonthBtn')?.addEventListener('click', () => { currentTransactionMonth.setMonth(currentTransactionMonth.getMonth()-1); updateTransactionsList(); });
    document.getElementById('nextTransactionMonthBtn')?.addEventListener('click', () => { currentTransactionMonth.setMonth(currentTransactionMonth.getMonth()+1); updateTransactionsList(); });
    document.getElementById('downloadMonthCSV')?.addEventListener('click', downloadMonthCSV);
    document.getElementById('downloadMonthPDF')?.addEventListener('click', downloadMonthPDF);
    document.getElementById('downloadAllCSV')?.addEventListener('click', downloadAllCSV);
    document.getElementById('downloadAllPDF')?.addEventListener('click', downloadAllPDF);
    document.getElementById('addCustomQuickBtn')?.addEventListener('click', () => addNewQuickItem());
    
    document.getElementById('transDate').value = getToday();
    
    loadData();
    loadNotifications();
    initDarkMode();
    setupNavigation();
    initCategoryFilter();
    buildCurrencyMenu();
    initNotificationPanel();
    processRecurringExpenses();
    checkBudgetAlerts();
    checkDailyLimit();
    updateAllPages();
    requestNotificationPermission();
})();