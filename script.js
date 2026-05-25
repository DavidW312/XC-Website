// Google Sheet ID: copy from docs.google.com/spreadsheets/d/{SHEET_ID}/edit
// Required tabs: Week* (mileage; col J = grade 9–12), Race_Results (Name, Meet, Date, Time, Distance)
const SHEET_ID = '1Y10L9EOvbB-8a3gjB-L9G5LMJ_Q70xDJsUGPlRcMHK4';
const API_KEY = 'AIzaSyAijjbGyF0cY0BLgEa_LmkYjyL1UDnQVQ8';

let currentWeekData = [];
let originalWeekData = [];
let meetData = [];
let meetSortState = { column: null, ascending: true };

window.addEventListener("DOMContentLoaded", async () => {
    await initDashboard();
    await fetchRaceResults();
    displaySelectedMeet();
    initAdvancedToggleView();
});

function initAdvancedToggleView() {
    const buttons = document.querySelectorAll(".view-btn");
    const main = document.querySelector("main");

    const sectionMap = {
        mileage: document.getElementById("mileage-section"),
        season: document.getElementById("season-insights-section"),
        results: document.getElementById("results-section")
    };

    buttons.forEach(button => {
        button.addEventListener("click", () => {
            const section = button.dataset.section;

            if (section === "all") {
                const isActive = button.classList.contains("active");
                buttons.forEach(b => b.classList.remove("active"));
                Object.values(sectionMap).forEach(sec => sec.classList.add("hidden-section"));

                if (!isActive) {
                    buttons.forEach(b => b.classList.add("active"));
                    Object.values(sectionMap).forEach(sec => sec.classList.remove("hidden-section"));
                }
            } else {
                button.classList.toggle("active");
                sectionMap[section].classList.toggle("hidden-section");

                const allButton = document.querySelector('[data-section="all"]');
                const allIndividualActive = [...buttons]
                    .filter(b => b.dataset.section !== "all")
                    .every(b => b.classList.contains("active"));
                allButton.classList.toggle("active", allIndividualActive);
            }

            updateGridLayout();
        });
    });

    function updateGridLayout() {
        const visibleSections = Object.values(sectionMap)
            .filter(sec => !sec.classList.contains("hidden-section"));
        main.style.gridTemplateColumns = visibleSections.length <= 1 ? "1fr" : "1fr 1fr";
    }
}

async function initDashboard() {
    const selector = document.getElementById('week-selector');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}&t=${Date.now()}`;

    try {
        const response = await fetch(url);
        const spreadsheet = await response.json();

        const weekSheets = spreadsheet.sheets
            .map(s => s.properties.title)
            .filter(title => title.includes("Week"));

        selector.innerHTML = "";
        weekSheets.forEach(title => {
            const option = document.createElement('option');
            option.value = title;
            option.textContent = title;
            selector.appendChild(option);
        });

        selector.addEventListener('change', function() {
            fetchWeeklyData(this.value);
        });

        if (weekSheets.length > 0) fetchWeeklyData(weekSheets[0]);
        calculateSeasonAnalytics(weekSheets);
    } catch (error) {
        console.error("Critical Init Error:", error);
    }
}

async function calculateSeasonAnalytics(weekNames) {
    let seasonTotals = {};
    let totalTeamMiles = 0;
    let totalAbsences = 0;
    let totalActiveDaysCount = 0;

    const weekDaysCols = [2, 3, 4, 5, 6, 7];

    const promises = weekNames.map(name =>
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(name)}!A2:J?key=${API_KEY}`)
            .then(res => res.json())
    );

    const allWeeksData = await Promise.all(promises);

    allWeeksData.forEach(week => {
        if (!week.values || week.values.length === 0) return;

        week.values.forEach(row => {
            const name = buildName(row);
            if (!name) return;

            if (!seasonTotals[name]) {
                seasonTotals[name] = {
                    miles: 0,
                    absences: 0,
                    A: 0,
                    XA: 0,
                    INJ: 0,
                    grade: parseGrade(row)
                };
            } else if (row[9] !== undefined && row[9] !== null && String(row[9]).trim() !== '') {
                seasonTotals[name].grade = parseGrade(row);
            }

            weekDaysCols.forEach(col => {
                let val = row[col];

                if (val === "A" || val === "INJ" || val === "XA") {
                    totalAbsences++;
                    seasonTotals[name].absences++;
                    seasonTotals[name][val]++;
                }

                const m = getMileageValue(val);
                seasonTotals[name].miles += m;
                totalTeamMiles += m;

                if (val && val !== "") {
                    totalActiveDaysCount++;
                }
            });
        });
    });

    renderSeasonUI(seasonTotals, totalTeamMiles, totalAbsences, totalActiveDaysCount);
}

function renderSeasonUI(totals, teamMiles, absences, possibleDays) {
    const teamMilesEl = document.getElementById('total-team-miles');
    const healthEl = document.getElementById('attendance-stat');

    if (teamMilesEl) teamMilesEl.textContent = Math.round(teamMiles);
    if (healthEl) {
        const health = possibleDays > 0
            ? ((1 - (absences / possibleDays)) * 100).toFixed(1)
            : "100";
        healthEl.textContent = `${health}%`;
    }

    const girlsLeadersHtml = ["<h4>Girls</h4>"];
    const boysLeadersHtml = ["<h4>Boys</h4>"];

    const gradeLeaders = {};
    Object.entries(totals).forEach(([name, data]) => {
        const gender = getGender(name);
        const grade = data.grade;
        const uniqueKey = `${gender}|${grade === null ? 'none' : grade}`;

        if (!gradeLeaders[uniqueKey] || data.miles > gradeLeaders[uniqueKey].miles) {
            gradeLeaders[uniqueKey] = { name, miles: data.miles, gender, grade };
        }
    });

    Object.values(gradeLeaders)
        .sort((a, b) => {
            if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
            return gradeSortKey(a.grade) - gradeSortKey(b.grade);
        })
        .forEach(leader => {
            const gradeLabel = formatGradeLabel(leader.grade);
            const itemHtml = `
            <p style="margin: 3px 0; font-size: 0.85rem;">
                <span style="font-weight: bold;">${gradeLabel}:</span>
                ${cleanName(leader.name)} (${leader.miles.toFixed(1)})
            </p>`;

            if (leader.gender === "Girls") {
                girlsLeadersHtml.push(itemHtml);
            } else {
                boysLeadersHtml.push(itemHtml);
            }
        });

    const girlsCol = document.getElementById('girls-leaders-column');
    const boysCol = document.getElementById('boys-leaders-column');
    if (girlsCol) girlsCol.innerHTML = girlsLeadersHtml.join('');
    if (boysCol) boysCol.innerHTML = boysLeadersHtml.join('');

    const leaderboardContainer = document.getElementById('season-leaderboard-container');
    if (leaderboardContainer) {
        const sorted = Object.entries(totals).sort((a, b) => b[1].miles - a[1].miles);
        let html = `<table><thead><tr><th>Rank</th><th>Name</th><th>Grade</th><th>Miles</th><th>Missed(A/XA/INJ)</th></tr></thead><tbody>`;

        sorted.forEach((entry, index) => {
            html += `<tr>
                <td>${index + 1}</td>
                <td class="name-cell">${cleanName(entry[0])}</td>
                <td style="font-size: 0.8rem; color: #667;">${formatGradeLabel(entry[1].grade)}</td>
                <td style="font-weight: bold; color: chocolate;">${entry[1].miles.toFixed(1)}</td>
                <td>
                    ${entry[1].absences}
                    <span class="miss-breakdown">
                        (
                        <span class="miss-a">${entry[1].A}</span> /
                        <span class="miss-xa">${entry[1].XA}</span> /
                        <span class="miss-inj">${entry[1].INJ}</span>
                        )
                    </span>
                </td>
            </tr>`;
        });
        leaderboardContainer.innerHTML = html + "</tbody></table>";
    }
}

async function fetchWeeklyData(tabName) {
    const container = document.getElementById('mileage-container');
    container.innerHTML = `<p>Loading ${tabName}...</p>`;

    const encodedTabName = encodeURIComponent(`'${tabName}'`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedTabName}!A1:J?key=${API_KEY}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.values && data.values.length > 0) {
            originalWeekData = data.values.slice(1);
            currentWeekData = [...originalWeekData];
            renderMileageTable(currentWeekData);
            updateTimestamp();
        } else {
            container.innerHTML = `<p>No data found for ${tabName}.</p>`;
        }
    } catch (error) {
        console.error("Weekly Fetch Error:", error);
    }
}

function renderMileageTable(rows) {
    const container = document.getElementById('mileage-container');

    const sortedRows = [...rows].sort((a, b) => {
        const genA = getGender(buildName(a));
        const genB = getGender(buildName(b));
        if (genA !== genB) return genA.localeCompare(genB);
        const gradeDiff = gradeSortKey(parseGrade(a)) - gradeSortKey(parseGrade(b));
        if (gradeDiff !== 0) return gradeDiff;
        return buildName(a).localeCompare(buildName(b));
    });

    const weekdayCols = [2, 3, 4, 5, 6, 7];
    const activeWeekdays = {};
    weekdayCols.forEach(colIdx => {
        activeWeekdays[colIdx] = rows.some(row => row[colIdx] && row[colIdx].toString().trim() !== '');
    });

    let htmlContent = `
        <table class="mileage-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>`;

    sortedRows.forEach(row => {
        if (!Array.isArray(row) || row.length < 2) return;

        const name = buildName(row);
        if (!name) return;

        const totalMiles = getMileageValue(row[8]);

        htmlContent += `<tr>
            <td class="name-cell">${cleanName(name)}</td>`;

        weekdayCols.forEach(colIdx => {
            let val = (row[colIdx] != null) ? String(row[colIdx]).trim() : '';
            if (val === "" && activeWeekdays[colIdx]) val = "P";
            const cellClass = getStatusClass(val);
            htmlContent += `<td class="${cellClass}">${val}</td>`;
        });

        htmlContent += `<td class="total-cell">${totalMiles.toFixed(1)}</td></tr>`;
    });

    htmlContent += "</tbody></table>";
    container.innerHTML = htmlContent;
}

window.sortMileage = function() {
    if (currentWeekData.length === 0) return;
    currentWeekData.sort((a, b) => getMileageValue(b[8]) - getMileageValue(a[8]));
    renderMileageTable(currentWeekData);
};

window.resetSort = function() {
    currentWeekData = [...originalWeekData];
    renderMileageTable(currentWeekData);
};

async function fetchRaceResults() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Race_Results!A2:E?key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data.values || data.values.length === 0) return;

        meetData = data.values;

        const meetMap = {};
        meetData.forEach(row => {
            const name = row[1];
            const dateStr = row[2] || "";
            if (name) {
                const ts = parseMeetDate(dateStr).getTime();
                if (!meetMap[name] || ts > meetMap[name].ts) {
                    meetMap[name] = { name, ts };
                }
            }
        });

        const sortedMeets = Object.values(meetMap).sort((a, b) => a.ts - b.ts).map(o => o.name);
        const selector = document.getElementById('xc-meet-selector');

        selector.innerHTML = sortedMeets.map(m => `<option value="${m}">${m}</option>`).join('');

        if (sortedMeets.length > 0) {
            selector.value = sortedMeets[sortedMeets.length - 1];
            document.getElementById('meet-results-controls').style.display = 'block';
            displaySelectedMeet();
        }

        updateTimestamp();
    } catch (error) {
        console.error("Meet Fetch Error:", error);
    }
}

window.displaySelectedMeet = function() {
    const selector = document.getElementById('xc-meet-selector');
    const selectedMeet = selector.value;
    const container = document.getElementById('meet-results-container');

    if (!selectedMeet) {
        container.innerHTML = "<p>Select a meet to view results.</p>";
        return;
    }

    const meetRows = meetData.filter(row => row[1] === selectedMeet);
    const distanceLabel = meetRows.find(r => r[4] && String(r[4]).trim())?.[4] || "";

    let html = `<div class="meet-summary">
        <h3>${selectedMeet}</h3>
        ${distanceLabel ? `<p><strong>Distance:</strong> ${distanceLabel}</p>` : ""}
    </div>`;

    html += `<table><thead><tr>
        <th class="sortable" onclick="sortMeetResults(0)">Athlete</th>
        <th class="sortable" onclick="sortMeetResults(1)">Time</th>
    </tr></thead><tbody>`;

    if (meetRows.length === 0) {
        html += `<tr><td colspan="2" style="text-align:center; padding:20px;">No results for this meet.</td></tr>`;
    } else {
        meetRows.forEach(row => {
            html += `<tr>
                <td class="name-cell">${cleanName(row[0] || "")}</td>
                <td>${row[3] || '-'}</td>
            </tr>`;
        });
    }

    html += "</tbody></table>";
    container.innerHTML = html;
};

window.filterMeetResults = function() {
    const searchTerm = document.getElementById('xc-meet-search').value.toLowerCase().trim();
    const container = document.getElementById('meet-results-container');
    const table = container.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const nameCell = row.querySelector('.name-cell');
        if (!nameCell) return;
        const name = nameCell.textContent.toLowerCase();
        row.style.display = name.includes(searchTerm) ? '' : 'none';
    });
};

window.sortMeetResults = function(columnIndex) {
    const container = document.getElementById('meet-results-container');
    const table = container.querySelector('table');
    if (!table) return;

    if (meetSortState.column === columnIndex) {
        meetSortState.ascending = !meetSortState.ascending;
    } else {
        meetSortState.column = columnIndex;
        meetSortState.ascending = true;
    }

    const tbody = table.querySelector('tbody');
    const rowsArray = Array.from(tbody.querySelectorAll('tr')).filter(row => row.querySelector('.name-cell'));

    rowsArray.sort((a, b) => {
        let valA = getSortValue(a, columnIndex);
        let valB = getSortValue(b, columnIndex);

        if (valA === valB) return 0;
        if (valA === '-' || valA === '') return 1;
        if (valB === '-' || valB === '') return -1;

        if (columnIndex === 0) {
            return meetSortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return meetSortState.ascending ? valA - valB : valB - valA;
    });

    rowsArray.forEach(row => tbody.appendChild(row));
    updateHeaderArrows(columnIndex);
};

function getSortValue(row, colIndex) {
    const cells = row.querySelectorAll('td');
    if (cells.length <= colIndex) return '';

    let text = cells[colIndex].textContent.trim();
    if (colIndex >= 1) return timeToSeconds(text) || 999999;
    return text;
}

function updateHeaderArrows(activeColumn) {
    const headers = document.querySelectorAll('#meet-results-container th.sortable');
    headers.forEach((th, index) => {
        th.classList.remove('active-asc', 'active-desc');
        if (index === activeColumn) {
            th.classList.add(meetSortState.ascending ? 'active-asc' : 'active-desc');
        }
    });
}

window.resetMeetSort = function() {
    const searchInput = document.getElementById("xc-meet-search");
    if (searchInput) searchInput.value = "";
    meetSortState = { column: null, ascending: true };
    displaySelectedMeet();
};

window.closeChart = function() {
    document.getElementById('chart-modal').style.display = 'none';
    document.getElementById('chart-overlay').style.display = 'none';
};

/** Column J: numeric grade (e.g. 9, 10, 11, 12). Returns null if missing/invalid. */
function parseGrade(row) {
    if (!row || row[9] === undefined || row[9] === null) return null;
    const raw = String(row[9]).trim();
    if (!raw) return null;
    const num = parseInt(raw, 10);
    if (isNaN(num)) return null;
    return num;
}

function gradeSortKey(grade) {
    return grade === null ? 999 : grade;
}

function formatGradeLabel(grade) {
    return grade === null ? '—' : String(grade);
}

function buildName(row) {
    const last = row[0] || "";
    const first = row[1] || "";
    return `${first} ${last}`.trim();
}

function getGender(name) {
    return name && name.includes("(F)") ? "Girls" : "Boys";
}

function cleanName(name) {
    return name ? name.replace("(F)", "").trim() : "";
}

function getMileageValue(val) {
    let num = parseFloat(val);
    return isNaN(num) ? 0 : num;
}

function getStatusClass(val) {
    if (val === "A") return "status-absent";
    if (val === "XA") return "status-excused";
    if (val === "INJ") return "status-injured";
    if (val === "P") return "status-present";
    return "";
}

function timeToSeconds(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === '-' || timeStr === '0' || timeStr === '') return 999999;
    const parts = timeStr.toString().split(':');
    if (parts.length === 2) {
        return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
    }
    return parseFloat(timeStr);
}

function parseMeetDate(dateStr) {
    if (!dateStr) return new Date(0);
    const str = String(dateStr).trim();
    const parts = str.split('/');
    if (parts.length === 3) {
        let m = parseInt(parts[0], 10);
        let d = parseInt(parts[1], 10);
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
        return new Date(y, m - 1, d);
    }
    return new Date(str);
}

function updateTimestamp() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Synced with Google Sheets: ${timeString}`;
}
