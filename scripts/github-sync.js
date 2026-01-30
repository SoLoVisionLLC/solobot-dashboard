#!/usr/bin/env node
/**
 * GitHub Sync for SoLoVision Dashboard
 * 
 * Fetches recent commits and activity from GitHub repos
 * and updates the dashboard state
 * 
 * Usage:
 *   node github-sync.js commits              # Fetch recent commits
 *   node github-sync.js activity             # Add GitHub activity to dashboard
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'solovision24/solobot-dashboard';

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
        console.error('Error loading state:', e.message);
        process.exit(1);
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function githubAPI(endpoint) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: endpoint,
            method: 'GET',
            headers: {
                'User-Agent': 'SoLoBot-Dashboard',
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        
        if (GITHUB_TOKEN) {
            options.headers['Authorization'] = `token ${GITHUB_TOKEN}`;
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
}

async function fetchCommits() {
    try {
        const commits = await githubAPI(`/repos/${REPO}/commits?per_page=5`);
        
        if (!Array.isArray(commits)) {
            console.log('No commits found or API error');
            return [];
        }
        
        const formatted = commits.map(c => ({
            sha: c.sha.substring(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            date: c.commit.author.date,
            url: c.html_url
        }));
        
        console.log('Recent commits:');
        formatted.forEach(c => {
            console.log(`  ${c.sha} - ${c.message} (${c.author})`);
        });
        
        return formatted;
    } catch (e) {
        console.error('Error fetching commits:', e.message);
        return [];
    }
}

async function syncActivity() {
    const state = loadState();
    const commits = await fetchCommits();
    
    if (commits.length > 0) {
        // Add most recent commit to activity
        const latest = commits[0];
        const alreadyLogged = state.activity.some(a => 
            a.action.includes(latest.sha)
        );
        
        if (!alreadyLogged) {
            state.activity.push({
                time: new Date(latest.date).getTime(),
                action: `GitHub commit ${latest.sha}: ${latest.message}`,
                type: 'info'
            });
            
            // Keep only last 100 entries
            if (state.activity.length > 100) {
                state.activity = state.activity.slice(-100);
            }
            
            saveState(state);
            console.log('Added commit to activity log');
        } else {
            console.log('Latest commit already logged');
        }
    }
}

async function getRepoStats() {
    try {
        const repo = await githubAPI(`/repos/${REPO}`);
        console.log(`Repository: ${repo.full_name}`);
        console.log(`Stars: ${repo.stargazers_count}`);
        console.log(`Forks: ${repo.forks_count}`);
        console.log(`Open Issues: ${repo.open_issues_count}`);
        console.log(`Default Branch: ${repo.default_branch}`);
        return repo;
    } catch (e) {
        console.error('Error fetching repo stats:', e.message);
        return null;
    }
}

// Main
const [,, command] = process.argv;

switch (command) {
    case 'commits':
        fetchCommits();
        break;
    case 'activity':
    case 'sync':
        syncActivity();
        break;
    case 'stats':
        getRepoStats();
        break;
    default:
        console.log('Usage: node github-sync.js [commits|activity|stats]');
}
