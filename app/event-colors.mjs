export const eventColors=[["","기본 색상",null],["1","라벤더","#a4bdfc"],["2","세이지","#7ae7bf"],["3","포도","#dbadff"],["4","홍학","#ff887c"],["5","바나나","#fbd75b"],["6","귤","#ffb878"],["7","공작","#46d6db"],["8","흑연","#e1e1e1"],["9","블루베리","#5484ed"],["10","바질","#51b749"],["11","토마토","#dc2127"]];

export function entryColor(e,project){return eventColors.find(c=>c[0]===e.eventColorId)?.[2]||[e.color,e.google?.calendarColor,project?.color].find(c=>/^#[a-f0-9]{6}$/i.test(c||''))||'#da3543';}
