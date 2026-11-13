/* StarCull · 核心：选择器、全局状态与常量 */

/* StarCull — front end */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  products: [],
  draw: null,
  points: 0,
  authMode: 'login',
  starredOnly: false,
  category: '',
  page: 1,
  view: 'collection',
  studioCategory: '',
  studioPage: 1,
  studioProducts: []
};

const PAGE_SIZE = 20;
const boardQuery = window.matchMedia('(min-width: 1101px) and (min-height: 700px)');
