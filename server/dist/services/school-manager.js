"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSchools = listSchools;
exports.getSchool = getSchool;
exports.addSchool = addSchool;
exports.updateSchool = updateSchool;
exports.removeSchool = removeSchool;
/**
 * 学校配置管理
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const config_js_1 = require("./config.js");
const DATA_DIR = path.resolve(config_js_1.AI_PLATFORM_ROOT, 'data');
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
function listSchools() {
    return readSchools().schools;
}
function getSchool(code) {
    return readSchools().schools.find((s) => s.code === code);
}
function addSchool(school) {
    const data = readSchools();
    if (data.schools.some((s) => s.code === school.code)) {
        throw new Error(`School already exists: ${school.code}`);
    }
    data.schools.push(school);
    writeSchools(data);
    return school;
}
function updateSchool(code, updates) {
    const data = readSchools();
    const index = data.schools.findIndex((s) => s.code === code);
    if (index === -1)
        throw new Error(`School not found: ${code}`);
    data.schools[index] = { ...data.schools[index], ...updates, code }; // code 不可改
    writeSchools(data);
    return data.schools[index];
}
function removeSchool(code) {
    const data = readSchools();
    const index = data.schools.findIndex((s) => s.code === code);
    if (index === -1)
        return false;
    data.schools.splice(index, 1);
    writeSchools(data);
    return true;
}
//# sourceMappingURL=school-manager.js.map