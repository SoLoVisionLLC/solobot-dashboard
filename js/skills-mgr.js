// js/skills-mgr.js — Skills Manager page

let skillsList = [];
let skillsInterval = null;

function initSkillsPage() {
    loadSkills();
    if (skillsInterval) clearInterval(skillsInterval);
    skillsInterval = setInterval(loadSkills, 60000);
}

async function loadSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to view skills</div>';
        return;
    }

    try {
        let result;
        try {
            result = await gateway._request('skills.list', {});
        } catch (e) {
            result = await gateway._request('skills.status', {});
        }
        skillsList = result?.skills || result || [];
        renderSkills();
    } catch (e) {
        console.warn('[Skills] Failed:', e.message);
        container.innerHTML = '<div class="empty-state">Could not load skills. The skills RPC may not be available.</div>';
    }
}

function renderSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!Array.isArray(skillsList) || skillsList.length === 0) {
        // If it's an object, convert
        if (typeof skillsList === 'object' && !Array.isArray(skillsList)) {
            skillsList = Object.entries(skillsList).map(([name, data]) => ({
                name, ...(typeof data === 'object' ? data : { status: data })
            }));
        }
        if (!skillsList || skillsList.length === 0) {
            container.innerHTML = '<div class="empty-state">No skills installed</div>';
            return;
        }
    }

    container.innerHTML = skillsList.map(skill => {
        const name = skill.name || skill.id || 'Unknown';
        const enabled = skill.enabled !== false;
        const status = skill.status || (enabled ? 'active' : 'disabled');
        const dotClass = status === 'active' || status === 'ready' ? 'success'
            : status === 'error' ? 'error' : 'idle';
        const hasApiKey = skill.apiKeyConfigured || skill.hasApiKey;
        const desc = skill.description || '';

        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 600; font-size: 14px;">${escapeHtml(name)}</span>
                        ${hasApiKey === true ? '<span style="font-size: 10px; color: var(--success);">🔑 Key configured</span>' : ''}
                        ${hasApiKey === false ? '<span style="font-size: 10px; color: var(--error);">🔑 Key missing</span>' : ''}
                    </div>
                    ${desc ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(desc)}</div>` : ''}
                    ${skill.version ? `<div style="font-size: 10px; color: var(--text-muted);">v${skill.version}</div>` : ''}
                </div>
                <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                    <button onclick="toggleSkill('${escapeHtml(name)}', ${!enabled})" 
                            class="btn ${enabled ? 'btn-ghost' : 'btn-primary'}" 
                            style="padding: 4px 10px; font-size: 11px;">
                        ${enabled ? 'Disable' : 'Enable'}
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.toggleSkill = async function(name, enable) {
    // Gateway RPC uses skills.update (not skills.toggle).
    // Config keys default to skill name unless metadata.openclaw.skillKey overrides it.
    // For now we treat the displayed name as the skillKey.
    try {
        await gateway._request('skills.update', { skillKey: name, enabled: enable });
        showToast(`Skill ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};
