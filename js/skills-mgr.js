// js/skills-mgr.js — Skills Manager page

let skillsList = [];
let skillsInterval = null;
let skillsPageBound = false;

const skillsUi = {
    search: '',
    onlyIssues: false
};

function initSkillsPage() {
    bindSkillsPageControls();
    loadSkills();

    if (skillsInterval) clearInterval(skillsInterval);
    skillsInterval = setInterval(loadSkills, 60000);
}

function bindSkillsPageControls() {
    if (skillsPageBound) return;
    skillsPageBound = true;

    const search = document.getElementById('skills-search');
    const onlyIssues = document.getElementById('skills-only-issues');
    const refresh = document.getElementById('skills-refresh');

    if (search) {
        search.addEventListener('input', () => {
            skillsUi.search = (search.value || '').trim().toLowerCase();
            renderSkills();
        });
    }

    if (onlyIssues) {
        onlyIssues.addEventListener('change', () => {
            skillsUi.onlyIssues = Boolean(onlyIssues.checked);
            renderSkills();
        });
    }

    if (refresh) {
        refresh.addEventListener('click', () => loadSkills());
    }
}

async function loadSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to view skills</div>';
        return;
    }

    try {
        // Prefer skills.status (rich, includes install options + requirements).
        // Fallback to skills.list for older gateways.
        let result;
        try {
            result = await gateway._request('skills.status', {});
            skillsList = result?.skills || [];
        } catch (e) {
            result = await gateway._request('skills.list', {});
            skillsList = result?.skills || result || [];
        }

        renderSkills();
    } catch (e) {
        console.warn('[Skills] Failed:', e.message);
        container.innerHTML = '<div class="empty-state">Could not load skills. The skills RPC may not be available.</div>';
    }
}

function skillHasIssues(skill) {
    // When skills.status is available, entries include missing + eligibility flags.
    const missing = skill?.missing || {};
    const missingCount = (missing.bins?.length || 0) + (missing.anyBins?.length || 0) + (missing.env?.length || 0) + (missing.config?.length || 0) + (missing.os?.length || 0);
    return Boolean(skill?.disabled || skill?.blockedByAllowlist || skill?.eligible === false || missingCount > 0);
}

function renderMissingBadges(skill) {
    const missing = skill?.missing || {};
    const blocks = [];

    const add = (label, items) => {
        if (!items || items.length === 0) return;
        const text = items.map(escapeHtml).join(', ');
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">
            <span style="font-weight: 600; color: var(--warning);">Missing ${escapeHtml(label)}:</span> ${text}
        </div>`);
    };

    add('bins', missing.bins);
    add('any bins', missing.anyBins);
    add('env', missing.env);
    add('config', missing.config);
    add('os', missing.os);

    if (skill?.blockedByAllowlist) {
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--error);">
            Blocked by bundled allowlist
        </div>`);
    }

    return blocks.join('');
}

function skillIsInstalled(skill) {
    // Heuristic: if the primary required bins are present, treat as installed.
    // (Missing env/config can mean “needs setup”, not “not installed”.)
    if (skill?.installed === true) return true;

    const missing = skill?.missing || {};
    const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
    return missingBins === 0;
}

function renderInstallButtons(skill) {
    const options = skill?.install || [];
    if (!Array.isArray(options) || options.length === 0) return '';

    const name = skill?.name;
    if (!name) return '';

    const installed = skillIsInstalled(skill);

    const installedBadge = installed
        ? `<span class="badge" style="background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.25); color: var(--success); padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;">Installed</span>`
        : '';

    const buttons = options.map(opt => {
        const baseLabel = opt?.label || 'Install';
        const installId = opt?.id;
        if (!installId) return '';

        const label = installed ? `Reinstall` : baseLabel;
        const klass = installed ? 'btn btn-ghost' : 'btn btn-primary';

        return `<button class="${klass}" style="padding: 4px 10px; font-size: 11px;" onclick="installSkill('${escapeHtml(name)}','${escapeHtml(installId)}')">${escapeHtml(label)}</button>`;
    }).join('');

    return [installedBadge, buttons].filter(Boolean).join('');
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

    const query = skillsUi.search;
    const filtered = skillsList
        .filter(skill => {
            const name = (skill?.name || skill?.id || '').toString();
            const desc = (skill?.description || '').toString();
            const key = (skill?.skillKey || '').toString();
            if (!query) return true;
            return name.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || key.toLowerCase().includes(query);
        })
        .filter(skill => skillsUi.onlyIssues ? skillHasIssues(skill) : true)
        .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));

    container.innerHTML = filtered.map(skill => {
        const name = skill?.name || skill?.id || 'Unknown';
        const skillKey = skill?.skillKey || name;
        const enabled = skill?.disabled ? false : (skill?.enabled !== false);

        const eligible = skill?.eligible;
        const showEligible = typeof eligible === 'boolean';

        const dotClass = (!enabled || skill?.disabled)
            ? 'idle'
            : (eligible === true ? 'success' : eligible === false ? 'error' : 'idle');

        const desc = skill?.description || '';
        const emoji = skill?.emoji || '🧩';
        const source = skill?.source ? `• ${escapeHtml(skill.source)}` : '';

        const topBadges = [
            showEligible ? (eligible ? '<span style="font-size: 10px; color: var(--success);">Ready</span>' : '<span style="font-size: 10px; color: var(--warning);">Needs attention</span>') : '',
            skill?.bundled ? '<span style="font-size: 10px; color: var(--text-muted);">Bundled</span>' : '',
            skill?.always ? '<span style="font-size: 10px; color: var(--text-muted);">Always</span>' : '',
        ].filter(Boolean).join('<span style="opacity:.35">•</span>');

        const installButtons = renderInstallButtons(skill);
        const missingBadges = renderMissingBadges(skill);

        const homepage = skill?.homepage ? `<a href="${escapeHtml(skill.homepage)}" target="_blank" style="font-size: 11px; color: var(--accent); text-decoration: none;">Homepage</a>` : '';

        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 10px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 650; font-size: 14px;">${escapeHtml(emoji)} ${escapeHtml(name)}</span>
                        ${topBadges ? `<span style="font-size: 10px; color: var(--text-muted);">${topBadges}</span>` : ''}
                        ${source ? `<span style="font-size: 10px; color: var(--text-muted);">${source}</span>` : ''}
                    </div>
                    ${desc ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(desc)}</div>` : ''}
                    <div style="margin-top: 6px; display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size: 10px; color: var(--text-faint);">skillKey: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(skillKey)}</span></span>
                        ${homepage}
                    </div>
                    ${missingBadges}
                </div>

                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${installButtons}
                    <button onclick="toggleSkill('${escapeHtml(skillKey)}', ${enabled ? 'false' : 'true'})" 
                            class="btn ${enabled ? 'btn-ghost' : 'btn-primary'}" 
                            style="padding: 4px 10px; font-size: 11px;">
                        ${enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="promptSetApiKey('${escapeHtml(skillKey)}', '${escapeHtml(skill?.primaryEnv || '')}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set key
                    </button>
                    <button onclick="promptSetEnv('${escapeHtml(skillKey)}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set env
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');

    if (!container.innerHTML.trim()) {
        container.innerHTML = '<div class="empty-state">No matching skills</div>';
    }
}

function showInstallModal(title, subtitle, body) {
    const titleEl = document.getElementById('skills-install-modal-title');
    const subtitleEl = document.getElementById('skills-install-modal-subtitle');
    const bodyEl = document.getElementById('skills-install-modal-body');

    if (titleEl) titleEl.textContent = title || 'Skill installer';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (bodyEl) bodyEl.textContent = body || '';

    showModal('skills-install-modal');
}

window.installSkill = async function(name, installId) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    showInstallModal(`Installing ${name}`, `Installer: ${installId}`, 'Running…');

    try {
        const result = await gateway._request('skills.install', { name, installId }, 600000);

        const warnings = Array.isArray(result?.warnings) && result.warnings.length > 0
            ? `\n\nWARNINGS:\n- ${result.warnings.join('\n- ')}`
            : '';

        const out = [
            `ok: ${String(result?.ok)}`,
            result?.message ? `message: ${result.message}` : '',
            typeof result?.code !== 'undefined' ? `code: ${String(result.code)}` : '',
            '',
            result?.stdout ? `STDOUT:\n${result.stdout}` : 'STDOUT: (empty)',
            '',
            result?.stderr ? `STDERR:\n${result.stderr}` : 'STDERR: (empty)',
        ].filter(Boolean).join('\n');

        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, out + warnings);

        showToast(result?.ok ? 'Install complete' : 'Install failed', result?.ok ? 'success' : 'error');
        loadSkills();
    } catch (e) {
        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, `ERROR: ${e.message}`);
        showToast('Install failed: ' + e.message, 'error');
    }
};

window.toggleSkill = async function(skillKey, enable) {
    try {
        await gateway._request('skills.update', { skillKey, enabled: enable });
        showToast(`Skill ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetApiKey = async function(skillKey, primaryEnv) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    const hint = primaryEnv ? ` (primary env: ${primaryEnv})` : '';
    const apiKey = window.prompt(`Enter API key for ${skillKey}${hint}.\n\nLeave blank to clear.`);
    if (apiKey === null) return; // cancelled

    try {
        await gateway._request('skills.update', { skillKey, apiKey });
        showToast('Saved key', 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetEnv = async function(skillKey) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    const key = window.prompt(`Env var name for ${skillKey} (e.g., FOO_TOKEN).\n\nLeave blank to cancel.`);
    if (key === null) return;
    const trimmedKey = (key || '').trim();
    if (!trimmedKey) return;

    const value = window.prompt(`Env var value for ${trimmedKey}.\n\nLeave blank to clear this key.`);
    if (value === null) return;

    try {
        await gateway._request('skills.update', { skillKey, env: { [trimmedKey]: value } });
        showToast('Saved env override', 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};
