import { classicSkin } from './classicSkin.js';
import { retroSkin } from './retroSkin.js';
import { modernSkin } from './modernSkin.js';
import { ninetiesSkin } from './ninetiesSkin.js';
const skins = { classic: classicSkin, retro: retroSkin, modern: modernSkin, nineties: ninetiesSkin };
export function getSkin(name) {
  if (!Object.hasOwn(skins, name)) throw new RangeError(`Unknown renderer skin: ${name}`);
  return skins[name];
}
