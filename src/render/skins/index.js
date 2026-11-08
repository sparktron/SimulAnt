import { classicSkin } from './classicSkin.js';
import { retroSkin } from './retroSkin.js';
import { modernSkin } from './modernSkin.js';
const skins = { classic: classicSkin, retro: retroSkin, modern: modernSkin };
export function getSkin(name) {
  if (!Object.hasOwn(skins, name)) throw new RangeError(`Unknown renderer skin: ${name}`);
  return skins[name];
}
