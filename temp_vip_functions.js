
    /**
     * ===========================================
     * 【VIP 管理功能】
     * ===========================================
     */

    // 加载 VIP 列表
    async function loadVips() {
      const container = document.getElementById('vipsListContainer');
      container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><div>加载中...</div></div>';

      try {
        const token = localStorage.getItem('admin_token') || localStorage.getItem('token');
        const response = await fetch('/api/admin/vip', {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token }
        });

        const result = await response.json();
        if (result.success && result.data) {
          renderVipsList(result.data.vips || []);
        } else {
          container.innerHTML = '<div class="empty-state"><p style="color: var(--text-secondary);">暂无 VIP 数据</p></div>';
        }
      } catch (error) {
        console.error('加载 VIP 列表失败:', error);
        container.innerHTML = '<div class="empty-state"><p style="color: var(--danger-color);">加载失败，请重试</p></div>';
      }
    }

    // 渲染 VIP 列表
    function renderVipsList(vips) {
      const container = document.getElementById('vipsListContainer');
      if (!vips || vips.length === 0) {
        container.innerHTML = '<div class="empty-state"><p style="color: var(--text-secondary);">暂无 VIP 等级，请添加</p></div>';
        return;
      }

      let rows = '';
      vips.forEach(v => {
        const levelBadge = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-weight: 700; font-size: 14px;">${v.level}</span>`;
        const commissionPercent = ((v.commission_rate || 0) * 100).toFixed(1) + '%';
        const vipData = JSON.stringify(v).replace(/"/g, '&quot;');
        
        rows += `<tr>
          <td>${levelBadge}</td>
          <td style="font-weight: 600; color: var(--text-primary);">${v.name}</td>
          <td style="font-weight: 600; color: var(--success-color);">${Number(v.price || 0).toFixed(2)}</td>
          <td><span style="padding: 4px 12px; border-radius: 12px; background: rgba(79, 172, 254, 0.1); color: #4facfe; font-weight: 600; font-size: 13px;">${commissionPercent}</span></td>
          <td style="color: var(--text-secondary);">${v.task_limit} 单/天</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn approve" onclick='editVip(${vipData})' title="编辑">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </button>
              <button class="action-btn reject" onclick="deleteVip(${v.id})" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
      });

      const tableHTML = `
        <table class="withdrawal-table" style="width: 100%;">
          <thead>
            <tr>
              <th>等级</th>
              <th>名称</th>
              <th>门槛 (USDT)</th>
              <th>佣金比例</th>
              <th>每日单数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      
      container.innerHTML = tableHTML;
    }

    // 提交 VIP 配置（新增或修改）
    async function submitVip() {
      const id = document.getElementById('vipEditId').value;
      const level = parseInt(document.getElementById('vipLevel').value);
      const name = document.getElementById('vipName').value.trim();
      const price = parseFloat(document.getElementById('vipPrice').value);
      const ratePercent = parseFloat(document.getElementById('vipRate').value);
      const limit = parseInt(document.getElementById('vipLimit').value);

      // 验证
      if (!level || level < 1) { showToast('请输入有效等级'); return; }
      if (!name) { showToast('请输入 VIP 名称'); return; }
      if (isNaN(price) || price < 0) { showToast('请输入有效金额'); return; }
      if (isNaN(ratePercent) || ratePercent < 0) { showToast('请输入有效佣金比例'); return; }
      if (!limit || limit < 1) { showToast('请输入有效任务上限'); return; }

      const commission_rate = ratePercent / 100;

      try {
        const token = localStorage.getItem('admin_token') || localStorage.getItem('token');
        const body = { level, name, price, commission_rate, task_limit: limit };
        if (id) body.id = parseInt(id);

        const response = await fetch('/api/admin/vip', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const result = await response.json();
        if (result.success) {
          showToast(result.message || (id ? 'VIP 更新成功' : 'VIP 添加成功'));
          resetVipForm();
          loadVips();
        } else {
          showToast(result.message || '操作失败');
        }
      } catch (error) {
        console.error('提交 VIP 失败:', error);
        showToast('操作失败，请重试');
      }
    }

    // 编辑 VIP（填充表单）
    function editVip(vip) {
      document.getElementById('vipEditId').value = vip.id;
      document.getElementById('vipLevel').value = vip.level;
      document.getElementById('vipName').value = vip.name;
      document.getElementById('vipPrice').value = vip.price;
      document.getElementById('vipRate').value = ((vip.commission_rate || 0) * 100).toFixed(1);
      document.getElementById('vipLimit').value = vip.task_limit;
      document.getElementById('vipFormTitle').textContent = '编辑 VIP 等级';
      
      // 平滑滚动到表单
      document.getElementById('vipLevel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 重置表单
    function resetVipForm() {
      document.getElementById('vipEditId').value = '';
      document.getElementById('vipLevel').value = '';
      document.getElementById('vipName').value = '';
      document.getElementById('vipPrice').value = '';
      document.getElementById('vipRate').value = '';
      document.getElementById('vipLimit').value = '';
      document.getElementById('vipFormTitle').textContent = '配置 VIP 等级';
    }

    // 删除 VIP
    async function deleteVip(vipId) {
      if (!confirm('确认删除这个 VIP 等级吗？\n注意：如有用户正在使用该等级，删除可能失败。')) return;
      
      try {
        const token = localStorage.getItem('admin_token') || localStorage.getItem('token');
        const response = await fetch(`/api/admin/vip/${vipId}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        const result = await response.json();
        if (result.success) {
          showToast('删除成功');
          loadVips();
        } else {
          showToast(result.message || '删除失败');
        }
      } catch (error) {
        console.error('删除 VIP 失败:', error);
        showToast('删除失败，请重试');
      }
    }
