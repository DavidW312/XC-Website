// Google Sheet ID: copy from docs.google.com/spreadsheets/d/{SHEET_ID}/edit
// Required tabs: Week* (mileage; col J = grade, col K = gender), Race_Results (Name, Meet, Date, Time, Distance)
let SHEET_ID = "";
const API_KEY = 'AIzaSyAijjbGyF0cY0BLgEa_LmkYjyL1UDnQVQ8';

const MASTER_SHEET_ID = "1p_4w2RODxODdMmu16FXdtiwDKAeCP6Ib4AihsI9rBj0";

let spreadsheetCache = {};
let weekDataCache = {};
let dashboardLoadID = 0;

// --- GLOBAL DECLARATIONS & ENGINE STATES ---
let currentWeekData = [];
let originalWeekData = [];

let seasonTotalsData = {};
let leaderboardFilter = {
    gender: "all",
    grade: "all"
}

let meetData = [];
let meetSortState = { column: null, ascending: true };

// PR Engine Core States
let allDistancePRs = [];
let distancePRSortState = { column: null, ascending: true };

// Strict Distance Configuration for the Progression Chart
const CHART_EVENT_CONFIGS = {
    distance: [
        { key: "xc_time", label: "Race Time Progression", type: "time" }
    ]
};

// --- INITIALIZATION ---
window.addEventListener("DOMContentLoaded", async () => {

    initAdvancedToggleView();

    await initSeasonSelector();

});

function initAdvancedToggleView() {
    const buttons = document.querySelectorAll(".view-btn");
    const main = document.querySelector("main");

    const sectionMap = {
        mileage: document.getElementById("mileage-section"),
        season: document.getElementById("season-insights-section"),
        pr: document.getElementById("pr-section"),
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
                    .filter(b => b.dataset.section !== "all" && b.style.display !== "none")
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

// Function for getting data from the master season index sheet
async function loadAvailableSeasons() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Season_Index!A2:C?key=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.values) {
        console.error("Season Index failed:", data);
        throw new Error("Could not load seasons");
    }

    return data.values;
}

// Function for creating the selector based on the seasons and ids in the master season index sheet
async function initSeasonSelector() {

    const selector = document.getElementById("season-selector");
    const seasons = await loadAvailableSeasons();

    selector.innerHTML = "";

    seasons.forEach(row => {

        const option = document.createElement("option");

        option.value = row[1];       // Sheet ID
        option.textContent = row[0]; // Year

        selector.appendChild(option);

    });

    // Restore last season if possible
    const saved = localStorage.getItem("selectedSeason");

    if (saved && [...selector.options].some(o => o.value === saved)) {
        selector.value = saved;
    } else {
        // Default to the last season in the list
        selector.selectedIndex = selector.options.length - 1;
    }

    SHEET_ID = selector.value;

    if (!SHEET_ID) {
        console.error("No season selected.");
        return;
    }

    await reloadDashboard();

    selector.addEventListener("change", async function(){

        SHEET_ID = this.value.trim();

        localStorage.setItem("selectedSeason", SHEET_ID);

        spreadsheetCache = {};
        weekDataCache = {};

        currentWeekData = [];
        originalWeekData = [];
        seasonTotalsData = {};
        meetData = [];
        allDistancePRs = [];

        await reloadDashboard();
    });

}

async function reloadDashboard() {

    const loadID = ++dashboardLoadID;

    currentWeekData = [];
    originalWeekData = [];
    seasonTotalsData = {};
    meetData = [];
    allDistancePRs = [];

    await initDashboard();

    if (loadID !== dashboardLoadID) return;

    const hasResults = await sheetExists("Race_Results");
    const hasPRs = await sheetExists("PRs");

    if (loadID !== dashboardLoadID) return;

    setOptionalFeatureVisibility(hasPRs, hasResults);

    if (hasResults) await fetchRaceResults();
    if (hasPRs) await fetchPRs();

    displaySelectedMeet();
}

function setOptionalFeatureVisibility(hasPRs, hasResults) {

    const prBtn = document.getElementById("pr-view-btn");
    const resultsBtn = document.getElementById("results-view-btn");

    const prSection = document.getElementById("pr-section");
    const resultsSection = document.getElementById("results-section");

    if (prBtn) prBtn.style.display = hasPRs ? "" : "none";
    if (prSection) prSection.style.display = hasPRs ? "" : "none";

    if (resultsBtn) resultsBtn.style.display = hasResults ? "" : "none";
    if (resultsSection) resultsSection.style.display = hasResults ? "" : "none";
}

async function initDashboard() {
    const selector = document.getElementById('week-selector');

    try {
        let spreadsheet;

        if (spreadsheetCache[SHEET_ID]) {
            spreadsheet = spreadsheetCache[SHEET_ID];
        } else {
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}`;
            const response = await fetch(url);
            spreadsheet = await response.json();
            spreadsheetCache[SHEET_ID] = spreadsheet;
            spreadsheet.tabNames = spreadsheet.sheets.map(
                s => s.properties.title
            );
        }

        const weekSheets = spreadsheet.sheets
            .map(s => s.properties.title)
            .filter(title => title.includes("Week"))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)?.[0] || 0);
                const numB = parseInt(b.match(/\d+/)?.[0] || 0);
                return numB - numA; // newest first
            });
        
        console.log("CURRENT SHEET:", SHEET_ID);
        console.log("ALL TABS:", spreadsheet.sheets.map(s => s.properties.title));

        selector.innerHTML = "";
        weekSheets.forEach(title => {
            const option = document.createElement('option');
            option.value = title;
            option.textContent = title;
            selector.appendChild(option);
        });

        selector.onchange = function () {
            fetchWeeklyData(this.value);
        }

        if (weekSheets.length > 0) {
            await fetchWeeklyData(weekSheets[0]);
        }

        await calculateSeasonAnalytics(weekSheets);
    } catch (error) {
        console.error("Critical Init Error:", error);
    }
}

function normalizeWeekRow(row, genderCell) {
    const out = [...(row || [])];
    while (out.length < 11) out.push("");
    if (genderCell !== undefined && genderCell !== null && String(genderCell).trim() !== "") {
        out[10] = String(genderCell).trim();
    }
    return out;
}

async function fetchWeekRows(tabName, startRow = 2) {

    const cacheKey = `${SHEET_ID}_${tabName}`;

    if (weekDataCache[cacheKey]) {
        return weekDataCache[cacheKey];
    }

    const enc = encodeURIComponent(`'${tabName}'`);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${enc}`;
    const mainRes = await fetch(`${base}!A${startRow}:K?key=${API_KEY}`);
    
    const main = await mainRes.json();

    const rows = main.values || [];

    const result = rows.map(row =>
        normalizeWeekRow(row, row[10])
    );

    weekDataCache[cacheKey] = result;

    return result;
}

async function calculateSeasonAnalytics(weekNames) {
    const requestSheetID = SHEET_ID;

    let seasonTotals = {};
    let totalTeamMiles = 0;
    let totalAbsences = 0;
    let totalActiveDaysCount = 0;

    const weekDaysCols = [2, 3, 4, 5, 6, 7];
    const allWeeksData = await Promise.all(weekNames.map(name => fetchWeekRows(name)));

    allWeeksData.forEach(weekRows => {
        if (!weekRows || weekRows.length === 0) return;

        weekRows.forEach(row => {
            const name = buildName(row);
            if (!name) return;

            if (!seasonTotals[name]) {
                seasonTotals[name] = {
                    miles: 0,
                    absences: 0,
                    A: 0,
                    XA: 0,
                    INJ: 0,
                    grade: parseGrade(row),
                    gender: parseGender(row)
                };
            } else {
                if (row[9] !== undefined && row[9] !== null && String(row[9]).trim() !== '') {
                    seasonTotals[name].grade = parseGrade(row);
                }
                if (row[10] !== undefined && row[10] !== null && String(row[10]).trim() !== '') {
                    seasonTotals[name].gender = parseGender(row);
                }
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

    if (requestSheetID !== SHEET_ID) return;

    renderSeasonUI(
        seasonTotals,
        totalTeamMiles,
        totalAbsences,
        totalActiveDaysCount
    );

    renderSeasonUI(seasonTotals, totalTeamMiles, totalAbsences, totalActiveDaysCount);
}

function renderSeasonUI(totals, teamMiles, absences, possibleDays) {
    seasonTotalsData = totals;
    
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
        const gender = data.gender || "Boys";
        const grade = data.grade;
        const uniqueKey = `${gender}|${grade === null ? 'none' : grade}`;

        if (!gradeLeaders[uniqueKey]) {
            // Initialize if the key doesn't exist yet
            gradeLeaders[uniqueKey] = { names: [name], miles: data.miles, gender, grade };
        } else if (data.miles > gradeLeaders[uniqueKey].miles) {
            // Found a new solo leader: overwrite miles and reset names array
            gradeLeaders[uniqueKey].miles = data.miles;
            gradeLeaders[uniqueKey].names = [name];
        } else if (data.miles === gradeLeaders[uniqueKey].miles) {
            // Found a tie: add this runner to the list
            gradeLeaders[uniqueKey].names.push(name);
        }
    });

    Object.values(gradeLeaders)
        .sort((a, b) => {
            if (a.gender !== b.gender) return a.gender.localeCompare(b.gender);
            return gradeSortKey(a.grade) - gradeSortKey(b.grade);
        })
        .forEach(leader => {
            const gradeLabel = leader.grade === null ? "Unassigned" : formatGradeLabel(leader.grade);
            
            // Clean all names in the array and join them with a comma
            const cleanedNames = leader.names.map(name => cleanName(name)).join(', ');

            const itemHtml = `
            <p style="margin: 3px 0; font-size: 0.85rem;">
                <span style="font-weight: bold;">${gradeLabel}:</span>
                ${cleanedNames} (${leader.miles.toFixed(1)})
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

    renderSeasonLeaderboard();
}

function renderSeasonLeaderboard() {
    const leaderboardContainer = document.getElementById('season-leaderboard-container');
    if (leaderboardContainer) {

        let athletes = Object.entries(seasonTotalsData);

        athletes = athletes.filter(([name, data]) => {

            const genderMatch =
                leaderboardFilter.gender === "all" ||
                data.gender === leaderboardFilter.gender;
        
            const gradeMatch =
                leaderboardFilter.grade === "all" ||
                data.grade === leaderboardFilter.grade;
        
            return genderMatch && gradeMatch;
        });
        let html = `<table><thead><tr><th>Rank</th><th>Name</th><th>Grade</th><th>Miles</th><th>Missed(A/XA/INJ)</th></tr></thead><tbody>`;

        athletes.sort((a, b) => b[1].miles - a[1].miles);

        athletes.forEach((entry, index) => {
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

function updateLeaderboardFilterButtons() {

    document
        .querySelectorAll('[data-gender]')
        .forEach(btn => {

            btn.classList.remove('active');

            if (
                btn.dataset.gender ===
                leaderboardFilter.gender
            ) {
                btn.classList.add('active');
            }
        });

    document
        .querySelectorAll('[data-grade]')
        .forEach(btn => {

            btn.classList.remove('active');

            if (
                btn.dataset.grade ===
                String(leaderboardFilter.grade)
            ) {
                btn.classList.add('active');
            }
        });
}

async function fetchWeeklyData(tabName) {

    const requestSheetID = SHEET_ID;

    const container = document.getElementById('mileage-container');
    container.innerHTML = `<p>Loading ${tabName}...</p>`;

    try {
        const enc = encodeURIComponent(`'${tabName}'`);
        const headerRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${enc}!A1:K?key=${API_KEY}`);
        const headerData = await headerRes.json();
        const mergedRows = await fetchWeekRows(tabName, 2);

        if (headerData.values && headerData.values.length > 0 && mergedRows.length > 0) {
            originalWeekData = sortMileageRows([...mergedRows]);
            currentWeekData = [...originalWeekData];

            if (requestSheetID !== SHEET_ID) return;

            renderMileageTable(currentWeekData);
            updateTimestamp();

        } else {
            container.innerHTML = `<p>No data found for ${tabName}.</p>`;
        }
    } catch (error) {
        console.error("Weekly Fetch Error:", error);
    }
}

function compareByLastName(a, b) {
    const lastCmp = String(a[0] || "").trim().localeCompare(String(b[0] || "").trim(), undefined, { sensitivity: "base" });
    if (lastCmp !== 0) return lastCmp;
    return String(a[1] || "").trim().localeCompare(String(b[1] || "").trim(), undefined, { sensitivity: "base" });
}

function sortMileageRows(rows) {
    return [...rows].sort((a, b) => {
        const gradeDiff = gradeSortKey(parseGrade(a)) - gradeSortKey(parseGrade(b));
        if (gradeDiff !== 0) return gradeDiff;
        return compareByLastName(a, b);
    });
}

function renderMileageTable(rows) {
    const container = document.getElementById('mileage-container');
    const weekdayCols = [2, 3, 4, 5, 6, 7];
    const colCount = 1 + weekdayCols.length + 1;

    const genderSections = [
        { label: "Boys", gender: "Boys" },
        { label: "Girls", gender: "Girls" }
    ];

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

    genderSections.forEach(section => {
        const sectionRows = rows.filter(row =>
            Array.isArray(row) &&
            row.length >= 2 &&
            buildName(row) &&
            parseGender(row) === section.gender
        );

        htmlContent += `<tr class="group-header-row"><td colspan="${colCount}">${section.label}</td></tr>`;

        if (sectionRows.length === 0) {
            htmlContent += `<tr><td colspan="${colCount}" style="text-align:center;color:#888;padding:12px;">No athletes in this section</td></tr>`;
            return;
        }

        sectionRows.forEach(row => {
            const name = buildName(row);
            let totalMiles = getMileageValue(row[8]);

            // Fallback: If Col I is blank or 0 (week in progress), calculate sum of M-S on the fly
            if (totalMiles === 0) {
                weekdayCols.forEach(colIdx => {
                    totalMiles += getMileageValue(row[colIdx]);
                });
            }

            htmlContent += `<tr>
                <td class="name-cell">${cleanName(name)}</td>`;

            weekdayCols.forEach(colIdx => {
                const val = (row[colIdx] != null) ? String(row[colIdx]).trim() : '';
                const cellClass = getStatusClass(val);
                htmlContent += `<td class="${cellClass}">${val}</td>`;
            });

            htmlContent += `<td class="total-cell">${totalMiles.toFixed(1)}</td></tr>`;
        });
    });

    htmlContent += "</tbody></table>";
    container.innerHTML = htmlContent;
}

window.sortMileage = function() {
    if (!currentWeekData || currentWeekData.length === 0) return;
    currentWeekData.sort((a, b) => {
        // Calculate dynamically if total column is blank
        let milesA = getMileageValue(a[8]);
        let milesB = getMileageValue(b[8]);

        if (milesA === 0) [2,3,4,5,6,7].forEach(c => milesA += getMileageValue(a[c]));
        if (milesB === 0) [2,3,4,5,6,7].forEach(c => milesB += getMileageValue(b[c]));

        return milesB - milesA;
    });
    renderMileageTable(currentWeekData);
};

window.resetSort = function() {
    currentWeekData = sortMileageRows([...originalWeekData]);
    renderMileageTable(currentWeekData);
};

window.setGenderFilter = function(gender) {
    leaderboardFilter.gender = gender;
    updateLeaderboardFilterButtons();
    
    console.log("Gender filter:", leaderboardFilter);
    
    renderSeasonLeaderboard();
};

window.setGradeFilter = function(grade) {
    leaderboardFilter.grade = grade;
    updateLeaderboardFilterButtons();

    console.log("Grade filter:", leaderboardFilter);
    
    renderSeasonLeaderboard();
};

// --- PERSONAL RECORDS (PR) ENGINE ---

async function fetchPRs() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/PRs!A1:F?key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.values) {
            allDistancePRs = data.values; // Assigned smoothly into explicit scope
            renderPRTable(orderedDistancePRRows(allDistancePRs));
            return true;
        }
    } catch (e) { 
        console.error("PR Fetch Error:", e); 
        return false; 
    }
}

function orderedDistancePRRows(rows) {
    if (!rows || rows.length === 0) return [];
    let data = rows.filter(row => row && row[0] && row[0].trim().toLowerCase() !== "name");
    
    if (distancePRSortState.column === null || distancePRSortState.column === undefined) {
        return data;
    }

    const columnIndex = distancePRSortState.column;
    const ascending = distancePRSortState.ascending;

    return [...data].sort((a, b) => {
        if (columnIndex === 0) {
            const nameA = String(a[0] || "").toLowerCase().trim();
            const nameB = String(b[0] || "").toLowerCase().trim();
            return ascending ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
        }
        const emptyA = isMissingTrackTime(a[columnIndex]);
        const emptyB = isMissingTrackTime(b[columnIndex]);
        if (emptyA && emptyB) return 0;
        if (emptyA) return 1;
        if (emptyB) return -1;
        const timeA = timeToSeconds(a[columnIndex]);
        const timeB = timeToSeconds(b[columnIndex]);
        return ascending ? timeA - timeB : timeB - timeA;
    });
}

function renderPRTable(rowsToRender) {
    const container = document.getElementById('pr-container');
    if (!container) return;

    const data = rowsToRender || allDistancePRs;
    const dataRows = data.filter(row => row[0] && row[0].trim().toLowerCase() !== "name");

    const getArrow = (col) => {
        if (distancePRSortState.column !== col) return "⇅";
        return distancePRSortState.ascending ? "▲" : "▼";
    };

    let html = `<table>
                <thead>
                    <tr>
                        <th onclick="sortPRs(0)" style="cursor:pointer">Name ${getArrow(0)}</th>
                        <th>3 Mile <button class="mini-sort" onclick="sortPRs(1)">${getArrow(1)}</button></th>
                        <th>5K <button class="mini-sort" onclick="sortPRs(2)">${getArrow(2)}</button></th>
                        <th>2 Mile <button class="mini-sort" onclick="sortPRs(3)">${getArrow(3)}</button></th>
                        <th>3200 <button class="mini-sort" onclick="sortPRs(4)">${getArrow(4)}</button></th>
                        <th>1600 <button class="mini-sort" onclick="sortPRs(5)">${getArrow(5)}</button></th>
                    </tr>
                </thead>
                <tbody>`;

    if (dataRows.length === 0) {
        html += `<tr><td colspan="6" style="text-align:center; padding:20px;">No athlete data found. Check your 'PRs' tab.</td></tr>`;
    } else {
        dataRows.forEach(row => {
            const safeName = (row[0] || "").replace(/'/g, "\\'");
            html += `<tr>
                <td class="name-cell" 
                    style="cursor:pointer; color:chocolate; text-decoration:underline;" 
                    onclick="window.showAthleteChart('${safeName}')">
                    ${cleanName(row[0])}
                </td>
                <td>${row[1] || '--'}</td>
                <td>${row[2] || '--'}</td>
                <td>${row[3] || '--'}</td>
                <td>${row[4] || '--'}</td>
                <td>${row[5] || '--'}</td>
            </tr>`;
        });
    }

    html += "</tbody></table>";
    container.innerHTML = html;
}

window.sortPRs = function(columnIndex) {
    const dataOnly = allDistancePRs.filter(row => row[0] && row[0].trim().toLowerCase() !== "name");
    if (dataOnly.length === 0) return;

    if (distancePRSortState.column === columnIndex) {
        distancePRSortState.ascending = !distancePRSortState.ascending;
    } else {
        distancePRSortState.column = columnIndex;
        distancePRSortState.ascending = true;
    }
    renderPRTable(orderedDistancePRRows(allDistancePRs));
};

window.filterPRs = function() {
    const searchInput = document.getElementById('pr-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const dataOnly = allDistancePRs.filter(row => row[0] && row[0].trim().toLowerCase() !== "name");
    const filtered = dataOnly.filter(row => row[0] && row[0].toLowerCase().includes(searchTerm));
    renderPRTable(orderedDistancePRRows(filtered));
};

window.resetPRs = function() {
    const searchInput = document.getElementById('pr-search');
    if (searchInput) searchInput.value = "";
    distancePRSortState = { column: null, ascending: true };
    renderPRTable(orderedDistancePRRows(allDistancePRs));
};


// --- MEET RESULTS ENGINE ---

async function fetchRaceResults() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Race_Results!A2:E?key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data.values || data.values.length === 0) {
            console.warn("No Race_Results found");
            meetData = [];
            return;
        }

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
        if (selector) {
            selector.innerHTML = sortedMeets.map(m => `<option value="${m}">${m}</option>`).join('');
            if (sortedMeets.length > 0) {
                selector.value = sortedMeets[sortedMeets.length - 1];
                document.getElementById('meet-results-controls').style.display = 'block';
                displaySelectedMeet();
            }
        }
        updateTimestamp();
    } catch (error) {
        console.error("Meet Fetch Error:", error);
    }
}

window.displaySelectedMeet = function() {
    if (meetData.length === 0) {
        document.getElementById('meet-results-container').innerHTML =
            "<p>No meet results available.</p>";
        return;
    }

    const selector = document.getElementById('xc-meet-selector');
    if (!selector) return;
    const selectedMeet = selector.value;
    const container = document.getElementById('meet-results-container');
    if (!container) return;

    if (!selectedMeet) {
        container.innerHTML = "<p>Select a meet to view results.</p>";
        return;
    }

    const meetRows = meetData.filter(row => row[1] === selectedMeet);
    const distanceLabel = meetRows.find(r => r[4] && String(r[4]).trim())?.[4] || "";

    let totalPerformances = 0;
    let totalPRs = 0;

    let html = "";

    html += `<table><thead><tr><th class="sortable" onclick="sortMeetResults(0)">Athlete</th><th class="sortable" onclick="sortMeetResults(1)">Time</th></tr></thead><tbody>`;

    if (meetRows.length === 0) {
        html += `<tr><td colspan="2" style="text-align:center; padding:20px;">No results for this meet.</td></tr>`;
    } else {
        meetRows.forEach(row => {

        const athleteName = row[0] || "";

        const athletePR = allDistancePRs.find(p =>
            (p[0] || "").trim().toLowerCase() === athleteName.trim().toLowerCase()
        ) || [];

        let raceTime = row[3] || "-";

        if (
            raceTime &&
            raceTime !== "-" &&
            raceTime !== "0"
        ) {
            totalPerformances++;
        }

        // Match distance to PR column
        let prTime = "";

        const distance = (row[4] || "").toLowerCase();

        if (distance.includes("3 mile")) {
            prTime = athletePR[1];
        }
        else if (distance.includes("5k") || distance.includes("5000")) {
            prTime = athletePR[2];
        }
        else if (distance.includes("2 mile")) {
            prTime = athletePR[3];
        }
        else if (distance.includes("3200")) {
            prTime = athletePR[4];
        }
        else if (distance.includes("1600") || distance.includes("mile")) {
            prTime = athletePR[5];
        }

        let displayTime = raceTime;

        if (isNewPR(raceTime, prTime)) {

            totalPRs++;

            const delta = formatTimeDelta(prTime, raceTime);

            displayTime =
            `<span class="pr-highlight">
                ${raceTime} ⭐ 
                <span class="pr-delta">${delta}</span>
            </span>`;
        }

        html += `
        <tr>
            <td class="name-cell">${cleanName(athleteName)}</td>
            <td>${displayTime}</td>
        </tr>`;
    });
    }

    html += "</tbody></table>";

    const prRate = totalPerformances > 0
        ? ((totalPRs / totalPerformances) * 100).toFixed(1)
        : 0;

    const summaryHTML = `<div class="meet-summary">
        <h3>${selectedMeet}</h3>
        ${distanceLabel ? `<p><strong>Distance:</strong> ${distanceLabel}</p>` : ""}
        <p>
            <strong>PR Rate:</strong>
            ${prRate}% 
            (${totalPRs} PR${totalPRs === 1 ? "" : "s"} out of ${totalPerformances} races)
        </p>
    </div>`;

    container.innerHTML = summaryHTML + html;
};

window.filterMeetResults = function() {
    const container = document.getElementById('meet-results-container');
    const table = container ? container.querySelector('table') : null;
    if (!table) return;

    const searchTerm = document.getElementById('xc-meet-search').value.toLowerCase().trim();
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
    const table = container ? container.querySelector('table') : null;
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


// --- UTILITY & HELPER FUNCTIONS ---
function cleanName(name) { return name ? name.replace("(F)", "").trim() : ""; }
function getMileageValue(val) { 
    if (!val || val === "" || val === "-" || val === "A" || val === "XA" || val === "INJ" || val === "P") return 0;
    let num = parseFloat(val); 
    return isNaN(num) ? 0 : num; 
}
function parseGrade(row) { if (!row || row[9] === undefined || row[9] === null) return null; const raw = String(row[9]).trim(); if (!raw) return null; const num = parseInt(raw, 10); return isNaN(num) ? null : num; }
function gradeSortKey(grade) { return grade === null ? 999 : grade; }
function formatGradeLabel(grade) { 
    return (grade === null || grade === undefined || grade === '') ? 'Unassigned' : String(grade); 
}
function buildName(row) { return `${row[1] || ""} ${row[0] || ""}`.trim(); }

function parseGender(row) {
    if (!row || row[10] === undefined || row[10] === null) return "Boys";
    const raw = String(row[10]).trim().toUpperCase();
    if (["F", "FEMALE", "G", "GIRL", "GIRLS"].includes(raw)) return "Girls";
    if (["M", "MALE", "B", "BOY", "BOYS"].includes(raw)) return "Boys";
    return "Boys";
}

function getStatusClass(val) {
    if (val === "A") return "status-absent";
    if (val === "XA") return "status-excused";
    if (val === "INJ") return "status-injured";
    if (val === "P") return "status-present";
    return "";
}

function timeToSeconds(timeStr) {

    if (!timeStr || timeStr === '--' || timeStr === '-' || timeStr === '0' || timeStr === '') {
        return 999999;
    }

    const parts = String(timeStr).trim().split(':');

    if (parts.length === 2) {
        return (parseInt(parts[0]) * 60) + parseFloat(parts[1]);
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

// PR STUFF BELOW
function isNewPR(raceTimeStr, prTimeStr) {
    if (!raceTimeStr || raceTimeStr === '-' || raceTimeStr === '0' || raceTimeStr.trim() === '') {
        return false;
    }

    const isFirstTime = (!prTimeStr || prTimeStr === '--' || prTimeStr.trim() === '');

    if (isFirstTime) return true;

    const raceSec = timeToSeconds(raceTimeStr);
    const prSec = timeToSeconds(prTimeStr);

    return raceSec <= prSec;
}


function formatTimeDelta(oldTime, newTime) {

    if (!oldTime || oldTime === '--') {
        return "Debut";
    }

    const delta = timeToSeconds(oldTime) - timeToSeconds(newTime);

    if (delta <= 0) return "";

    const minutes = Math.floor(delta / 60);
    const seconds = Math.floor(delta % 60);
    const milliseconds = Math.round((delta % 1) * 100);

    const tenths = Math.round((delta % 1) * 10);

    return `-${minutes}:${seconds.toString().padStart(2,'0')}.${tenths}`;
}
// PR STUFF ABOVE

function updateTimestamp() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Synced with Google Sheets: ${timeString}`;
}

function isMissingTrackTime(val) {
    if (val === undefined || val === null) return true;
    const str = String(val).trim();
    return str === '' || str === '-' || str === '--' || str === '0';
}

function normalizeNameForMatch(name) {
    if (!name) return "";
    return name.toString().toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}


function sheetExists(tabName) {

    const spreadsheet = spreadsheetCache[SHEET_ID];

    if (!spreadsheet || !spreadsheet.tabNames) {
        return false;
    }

    return spreadsheet.tabNames.includes(tabName);
}


// --- REFIGURED DISTANCE DATA & PROGRESSION CHART ENGINE ---

function getAthleteMeetData(athleteName) {
    const searchNorm = normalizeNameForMatch(athleteName);
    if (!searchNorm || !meetData || meetData.length === 0) return [];
    return meetData.filter(row => {
        const nameInRow = Array.isArray(row) ? row[0] : (row.name || '');
        return nameInRow && normalizeNameForMatch(nameInRow) === searchNorm;
    });
}

window.showAthleteChart = function(athleteName) {
    if (!athleteName) return;

    const athleteRaces = getAthleteMeetData(athleteName);
    if (athleteRaces.length === 0) {
        alert(`No meet results found for ${cleanName(athleteName)}.`);
        return;
    }

    // 1. Unveil the Modal Elements safely
    const modal = document.getElementById('chart-modal');
    const overlay = document.getElementById('chart-overlay');

    if (modal && overlay) {
        modal.style.setProperty('display', 'block', 'important');
        overlay.style.setProperty('display', 'block', 'important');
        
        const title = document.getElementById('chart-title');
        if (title) title.textContent = cleanName(athleteName);
    }

    // 2. Scan and extract all unique distances this specific runner has competed in
    const uniqueDistances = [...new Set(athleteRaces.map(row => {
        const dist = Array.isArray(row) ? row[4] : row.distance;
        return dist ? dist.toString().trim() : "";
    }).filter(d => d !== ""))];

    // Fallback default if distance cells are left completely blank in your spreadsheet row
    if (uniqueDistances.length === 0) {
        uniqueDistances.push("XC Race");
    }

    // 3. Clear existing wrapper selectors and inject clean navigation tabs
    let wrapper = document.getElementById('chart-content-wrapper');
    let tabContainer = document.getElementById('modal-tab-bar');
    
    if (!tabContainer) {
        tabContainer = document.createElement('div');
        tabContainer.id = 'modal-tab-bar';
        tabContainer.className = 'modal-tabs';
        wrapper.parentNode.insertBefore(tabContainer, wrapper);
    }

    // Render a button tab container dynamically matching their background profile
    tabContainer.innerHTML = uniqueDistances.map((dist, idx) => `
        <button class="tab-btn ${idx === 0 ? 'active' : ''}" onclick="window.switchChartDistance('${athleteName.replace(/'/g, "\\'")}', '${dist}', this)">
            ${dist}
        </button>
    `).join('');

    // 4. Draw the progression logic for the very first distance filter row
    updateChartLogic(athleteRaces, uniqueDistances[0]);
};

/**
 * Switchboard utility guiding tab selections inside your global window execution frame
 */
window.switchChartDistance = function(athleteName, selectedDistance, buttonElement) {
    // Demote old active classes
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    
    // Promote selected tab indicator highlight
    if (buttonElement) buttonElement.classList.add('active');

    const athleteRaces = getAthleteMeetData(athleteName);
    updateChartLogic(athleteRaces, selectedDistance);
};

function updateChartLogic(athleteRaces, targetDistance) {
    if (typeof Chart === 'undefined') {
        console.error("Chart.js library is not loaded.");
        return;
    }

    // Filter results strictly matching the selected distance tab line
    let plotData = athleteRaces.map(row => {
        const meetName = Array.isArray(row) ? row[1] : row.meet;
        const meetDate = Array.isArray(row) ? row[2] : row.date;
        const timeStr = Array.isArray(row) ? row[3] : row.time;
        const distanceLabel = Array.isArray(row) ? row[4] : "";

        return {
            meet: meetName || "Meet",
            date: meetDate || "",
            value: timeToSeconds(timeStr),
            displayVal: timeStr,
            distance: distanceLabel ? distanceLabel.trim() : "XC Race"
        };
    }).filter(d => {
        // Match conditions: clean string validation against user target selection profile
        const distanceMatches = (targetDistance === "XC Race") || (d.distance === targetDistance);
        return distanceMatches && d.displayVal && d.displayVal !== '-' && d.displayVal !== '0' && d.value > 0 && d.value < 999999;
    });

    // Arrange historical points cleanly by date
    plotData.sort((a, b) => parseMeetDate(a.date) - parseMeetDate(b.date));

    const canvas = document.getElementById('progressionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (window.myChart instanceof Chart) window.myChart.destroy();
    
    if (plotData.length === 0) {
        // Clear canvas if no valid times exist for this distance layout view
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    window.myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: plotData.map(d => d.date ? `${d.meet} (${d.date})` : d.meet),
            datasets: [{
                label: targetDistance,
                data: plotData.map(d => d.value),
                borderColor: 'chocolate',
                backgroundColor: 'rgba(210, 105, 30, 0.2)',
                borderWidth: 3,
                tension: 0.2,
                fill: true,
                pointRadius: 6,
                pointHoverRadius: 9,
                pointBackgroundColor: 'chocolate'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    reverse: true, // Lower/faster race track values scale towards the top beautifully
                    ticks: {
                        callback: (v) => {
                            const m = Math.floor(v / 60);
                            const s = Math.floor(v % 60);
                            return `${m}:${s < 10 ? '0' : ''}${s}`;
                        }
                    }
                }
            },
            plugins: {
                legend: { display: true },
                tooltip: {
                    callbacks: { label: (ctx) => `Time: ${plotData[ctx.dataIndex].displayVal}` }
                }
            }
        }
    });
}

window.closeChart = function() {
    // Wipe tabs clear upon modal close to reset navigation layout templates cleanly
    const tabContainer = document.getElementById('modal-tab-bar');
    if (tabContainer) tabContainer.innerHTML = "";

    document.getElementById('chart-modal').style.setProperty('display', 'none', 'important');
    document.getElementById('chart-overlay').style.setProperty('display', 'none', 'important');
};

// --- SYSTEM SYNC AUTO-LOAD TRIGGER ---
window.addEventListener("load", () => {
    setTimeout(() => {
        if (typeof resetPRs === "function") resetPRs();
    }, 1000); 
});
