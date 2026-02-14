// js/skills-mgr.js — Skills Manager page

let skillsList = [];
let skillsInterval = null;
let skillsPageBound = false;

const skillsUi = {
    search: '',
    onlyIssues: false,
    onlyInstalled: true
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

    const onlyInstalled = document.getElementById('skills-only-installed');
    if (onlyInstalled) {
        onlyInstalled.checked = skillsUi.onlyInstalled;
        onlyInstalled.addEventListener('change', () => {
            skillsUi.onlyInstalled = Boolean(onlyInstalled.checked);
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

function skillIsReady(skill) {
    // “Ready” means prerequisites/binaries are present.
    // This is NOT the same thing as “installed” (many skills are bundled).
    const missing = skill?.missing || {};
    const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
    return missingBins === 0;
}

function renderInstallButtons(skill) {
    const options = skill?.install || [];
    if (!Array.isArray(options) || options.length === 0) return '';

    const name = skill?.name;
    if (!name) return '';

    // Only show "Reinstall" if the gateway explicitly reports installed=true.
    // Otherwise we keep the installer’s label (often these buttons install prerequisites like `uv`).
    const installed = skill?.installed === true;
    const ready = skillIsReady(skill);

    const readyBadge = ready
        ? `<span class="badge" style="background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.25); color: var(--success); padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;">Ready</span>`
        : '';

    const buttons = options.map(opt => {
        const baseLabel = opt?.label || 'Install';
        const installId = opt?.id;
        if (!installId) return '';

        const label = installed ? 'Reinstall' : baseLabel;
        const klass = installed ? 'btn btn-ghost' : 'btn btn-primary';

        return `<button class="${klass}" style="padding: 4px 10px; font-size: 11px;" onclick="installSkill('${escapeHtml(name)}','${escapeHtml(installId)}')">${escapeHtml(label)}</button>`;
    }).join('');

    return [readyBadge, buttons].filter(Boolean).join('');
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
        .filter(skill => {
            if (!skillsUi.onlyInstalled) return true;
            // "Installed" means actually usable: ready (no missing bins) AND eligible for this OS
            const missing = skill?.missing || {};
            const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
            const missingOs = (missing.os || []).length > 0;
            if (missingOs || missingBins > 0) return false;
            return skill?.installed === true || skill?.bundled === true || skill?.enabled !== false;
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
                    <button onclick="viewSkillFiles('${escapeHtml(skillKey)}', '${escapeHtml(skill?.path || '')}')" 
                            class="btn btn-ghost" 
                            style="padding: 4px 10px; font-size: 11px;"
                            title="View and edit skill files">
                        📂 Files
                    </button>
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

// ========== Skill File Viewer/Editor ==========

let currentSkillFiles = [];
let currentSkillPath = '';
let currentSkillName = '';
let currentEditingFile = null;

window.viewSkillFiles = async function(skillKey, skillPath) {
    currentSkillPath = skillPath || '';
    currentSkillName = skillKey;
    
    const titleEl = document.getElementById('skill-files-modal-title');
    const treeEl = document.getElementById('skill-files-tree');
    const previewEl = document.getElementById('skill-file-preview');

    if (titleEl) titleEl.textContent = `📂 ${skillKey}`;
    if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">Loading...</div>';
    if (previewEl) previewEl.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Select a file to view</div>';

    showModal('skill-files-modal');

    try {
        // Use dashboard API for file listing
        const resp = await fetch(`/api/skills/${encodeURIComponent(skillKey)}/files`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load files');
        }
        const result = await resp.json();
        currentSkillFiles = result?.files || [];
        currentSkillPath = result?.path || skillPath || '';

        if (currentSkillFiles.length === 0) {
            if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">No files found</div>';
            return;
        }

        renderSkillFilesTree(currentSkillFiles);

        // Auto-open SKILL.md if present
        const skillMd = currentSkillFiles.find(f => f.name === 'SKILL.md' || f.relativePath === 'SKILL.md');
        if (skillMd) {
            previewSkillFile(skillMd.relativePath || 'SKILL.md');
        }
    } catch (e) {
        console.warn('[Skills] Failed to load files:', e.message);
        if (treeEl) treeEl.innerHTML = `<div style="color: var(--error); padding: 8px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

function renderSkillFilesTree(files) {
    const container = document.getElementById('skill-files-tree');
    if (!container) return;

    // Build tree structure from relativePath
    const tree = {};
    for (const f of files) {
        const relPath = f.relativePath || f.name || '';
        const parts = relPath.split('/').filter(Boolean);
        
        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!node._files) node._files = [];
                node._files.push({ ...f, fileName: part, relPath: relPath });
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        }
    }

    container.innerHTML = renderSkillTreeNode(tree, '');
}

function renderSkillTreeNode(node, prefix) {
    let html = '';

    // Render subdirectories first
    const dirs = Object.keys(node).filter(k => k !== '_files').sort();
    for (const dir of dirs) {
        html += `
        <div class="skill-tree-dir" onclick="toggleSkillTreeDir(this)" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px;">
            <span class="tree-chevron" style="font-size: 10px; color: var(--text-muted);">▶</span>
            <span style="font-size: 12px;">📁 ${escapeHtml(dir)}</span>
        </div>
        <div class="skill-tree-children hidden" style="padding-left: 16px;">
            ${renderSkillTreeNode(node[dir], prefix ? `${prefix}/${dir}` : dir)}
        </div>`;
    }

    // Render files
    const files = node._files || [];
    for (const f of files.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''))) {
        const icon = getFileIcon(f.fileName);
        html += `
        <div class="skill-tree-file" onclick="previewSkillFile('${escapeHtml(f.relPath)}')" 
             style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px;"
             onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
            <span>${icon}</span>
            <span>${escapeHtml(f.fileName)}</span>
        </div>`;
    }

    return html;
}

function getFileIcon(fileName) {
    if (!fileName) return '📄';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const icons = {
        'md': '📝',
        'py': '🐍',
        'sh': '🔧',
        'js': '📜',
        'json': '📋',
        'yaml': '📋',
        'yml': '📋',
        'txt': '📄',
    };
    return icons[ext] || '📄';
}

window.toggleSkillTreeDir = function(el) {
    const children = el.nextElementSibling;
    if (!children) return;
    const chevron = el.querySelector('.tree-chevron');
    if (children.classList.contains('hidden')) {
        children.classList.remove('hidden');
        if (chevron) chevron.textContent = '▼';
    } else {
        children.classList.add('hidden');
        if (chevron) chevron.textContent = '▶';
    }
};

window.previewSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    preview.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Loading...</div>';
    currentEditingFile = relPath;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();
        const isEditable = /\.(md|txt|py|sh|js|json|yaml|yml)$/i.test(fileName);
        const isBundled = !currentSkillPath.includes('/workspace/skills');

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px; align-items: center;">
                    ${isBundled ? '<span style="font-size: 10px; color: var(--warning);">Read-only (bundled)</span>' : ''}
                    ${isEditable && !isBundled ? `<button onclick="editSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">Edit</button>` : ''}
                </div>
            </div>
            <pre id="skill-file-content" style="padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow-y: auto; flex: 1; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</pre>
        `;
    } catch (e) {
        preview.innerHTML = `<div style="color: var(--error); padding: 20px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

window.editSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">✏️ Editing: ${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px;">
                    <button onclick="previewSkillFile('${escapeHtml(relPath)}')" class="btn btn-ghost" style="font-size: 11px; padding: 4px 10px;">Cancel</button>
                    <button onclick="saveSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">💾 Save</button>
                </div>
            </div>
            <textarea id="skill-file-editor" style="width: 100%; flex: 1; padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; border: none; resize: none; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</textarea>
        `;

        // Focus the textarea
        const textarea = document.getElementById('skill-file-editor');
        if (textarea) textarea.focus();
    } catch (e) {
        showToast('Failed to load file: ' + e.message, 'error');
    }
};

window.saveSkillFile = async function(relPath) {
    const textarea = document.getElementById('skill-file-editor');
    if (!textarea) return;

    const content = textarea.value;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save file');
        }
        
        showToast('File saved', 'success');
        previewSkillFile(relPath);
    } catch (e) {
        showToast('Failed to save: ' + e.message, 'error');
    }
};
