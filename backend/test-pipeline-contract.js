/**
 * Regression checks for the Pipeline kanban:
 * - handleDrop must PATCH { pipeline_stage: newStage } (not { field, value })
 * - the board must load GET /api/businesses (full set), not /crm/pipeline (limit 50)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin-dashboard.html'), 'utf8');

const handleDropStart = html.indexOf('async function handleDrop');
assert.ok(handleDropStart > 0, 'handleDrop must exist');
const handleDrop = html.slice(handleDropStart, html.indexOf('// --- ACTIVITIES ---', handleDropStart));

assert.match(
    handleDrop,
    /body:\s*\{\s*pipeline_stage:\s*newStage\s*\}/,
    'handleDrop must send { pipeline_stage: newStage } so PATCH Object.entries updates that field'
);
assert.doesNotMatch(
    handleDrop,
    /field:\s*['"]pipeline_stage['"]/,
    'handleDrop must not send { field, value } — backend treats those as column names'
);

const renderStart = html.indexOf('async function renderPipeline');
assert.ok(renderStart > 0, 'renderPipeline must exist');
const renderPipeline = html.slice(renderStart, html.indexOf('async function handleDrop', renderStart));

assert.match(renderPipeline, /api\('\/businesses'\)/, 'Pipeline must load GET /api/businesses');
assert.doesNotMatch(renderPipeline, /\/crm\/pipeline/, 'Pipeline must not use /crm/pipeline (limit 50)');

const allowed = ['status', 'verification_status', 'pipeline_stage', 'priority', 'assigned_to', 'is_featured', 'last_contacted', 'notes'];
function applyPatch(body) {
    const updated = {};
    for (const [field, value] of Object.entries(body)) {
        if (allowed.includes(field)) updated[field] = value;
    }
    return updated;
}

assert.deepStrictEqual(
    applyPatch({ field: 'pipeline_stage', value: 'contacted' }),
    {},
    'legacy { field, value } body must not update pipeline_stage'
);
assert.deepStrictEqual(
    applyPatch({ pipeline_stage: 'contacted' }),
    { pipeline_stage: 'contacted' },
    'correct body must persist pipeline_stage'
);

assert.match(html, /Basic/, 'column label Basic');
assert.match(html, /Phone checked/, 'column label Phone checked');
assert.match(html, /Has a site/, 'column label Has a site');
assert.match(html, /Social\/Maps/, 'column label Social/Maps');
assert.match(html, />Blurb</, 'column label Blurb');

const paintStart = html.indexOf('function paintPipelineBoard');
const paintEnd = html.indexOf('async function renderPipeline', paintStart);
const paint = html.slice(paintStart, paintEnd);
assert.doesNotMatch(paint, /Weighted Forecast|Stagnant Deals|Activity This Week/, 'forecast/KPI strip must stay off the board');

console.log('pipeline contract ok');
