/**
 * 学校配置管理
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AI_PLATFORM_ROOT } from './config.js';
const DATA_DIR = path.resolve(AI_PLATFORM_ROOT, 'data');
const SCHOOLS_FILE = path.join(DATA_DIR, 'schools.yaml');
function readSchools() {
    if (!fs.existsSync(SCHOOLS_FILE))
        return { schools: [] };
    const content = fs.readFileSync(SCHOOLS_FILE, 'utf-8');
    return yaml.load(content);
}
function writeSchools(data) {
    if (!fs.existsSync(DATA_DIR))
        fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SCHOOLS_FILE, yaml.dump(data, { indent: 2 }), 'utf-8');
}
export function listSchools() {
    return readSchools().schools;
}
export function getSchool(code) {
    return readSchools().schools.find((s) => s.code === code);
}
export function addSchool(school) {
    const data = readSchools();
    if (data.schools.some((s) => s.code === school.code)) {
        throw new Error(`School already exists: ${school.code}`);
    }
    data.schools.push(school);
    writeSchools(data);
    return school;
}
export function updateSchool(code, updates) {
    const data = readSchools();
    const index = data.schools.findIndex((s) => s.code === code);
    if (index === -1)
        throw new Error(`School not found: ${code}`);
    data.schools[index] = { ...data.schools[index], ...updates, code }; // code 不可改
    writeSchools(data);
    return data.schools[index];
}
export function removeSchool(code) {
    const data = readSchools();
    const index = data.schools.findIndex((s) => s.code === code);
    if (index === -1)
        return false;
    data.schools.splice(index, 1);
    writeSchools(data);
    return true;
}
//# sourceMappingURL=school-manager.js.map