#!/usr/bin/env node
 
/*var lib= require('../lib/index.js');
var greeting = lib.sayHello('Bret');
 
console.log(greeting);*/

const fs = require('fs'),
      path = require('path'),
      yaml = require('js-yaml')
      
const currPath = '/Users/danny/Projects/drupal-composer-builder/modules'
//const currPath = path.resolve('.')


const dirs = p => {
  return fs.readdirSync(p)
              .filter(f => fs.statSync(path.join(p, f)).isDirectory())
              .filter(f => !(/(^|\/)\.[^\/\.]/g).test(f))
}

const composerJson = {}

dirs(currPath).map(module => {
  try {
    const configFile = `/${module}.info.yml`
    const configPath = path.join(currPath, module, configFile)
    if (!fs.existsSync(configPath)) return
    const contents = fs.readFileSync(configPath, 'utf8')
    // Parse YML into object
    const config = yaml.safeLoad(contents)
    const verArray = config.version.split('-')
    let verString = `^${verArray[1]}`
    // If the version contains a version state append it
    if(2 in verArray) {
      const symbol = (verArray[2] == 'dev') ? '-' : '@'
      verString += symbol + verArray[2].replace(/[0-9]/g, '')
    }
    composerJson[`drupal/${module}`] = verString
  } catch (e) {
    console.log(e);
  }
  
})

console.log(composerJson);
