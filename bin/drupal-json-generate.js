const config = require('../lib/config'),
      fs = require('fs'),
      path = require('path'),
      yaml = require('js-yaml'),
      inquirer = require('inquirer'),
      request = require('request-promise'),
      console = require('console'),
      _ = require('lodash')
      

const app = {
  config: config,
  currPath: path.resolve('.'),
  appPath: '',
  composerLocal: {},
  drupalVer: '',
  init: function() {
    inquirer.prompt([{
      type: 'input',
      name: 'drupalLocation',
      message: 'Where is your Drupal app located?',
      default: this.config.drupalRoot
    }])
      .then(this.operate.bind(this))
  },
  operate: function(answers) {
    const appPath = path.join(this.currPath, answers.drupalLocation)
    if (!fs.existsSync(appPath)) {
      return console.log(`${appPath} is not valid please try again with a valid directory`)
    }
    this.appPath = appPath
    
    const composerLocal = this.getComposerLocal()
    const drupalVer = composerLocal.replace['drupal/core'].replace(/[^0-9.]/g, '')
    this.drupalVer = drupalVer
    
    this.getRemoteTemplates()
      .then((results) => {
        const drupalDefaultModules = results.drupalDefaultComposer.require
        const drupalLocalModules = composerLocal.require
        // Compare local modules against remote to determine which were installed
        const composerModules = this.shallowDiff(
                                    drupalLocalModules, 
                                    drupalDefaultModules)
        const drushModules = {}
        const modulePaths = Object.keys(this.config.modulePaths)
        // Construct composer syntax for all currently isntalled modules
        modulePaths.map((key, i) => {
          const baseModulePath = this.config.modulePaths[key]
          const modulePath = path.join(appPath, baseModulePath)
          drushModules[modulePaths[i]] = this.getDrushModules(modulePath)
        })
        
        //console.log(drushModules)
        // Combine all known modules for composer
        const combinedModules = _.defaults(
                                  composerModules, 
                                  drushModules.base,
                                  drushModules.contrib)
        console.log(combinedModules)
      })
      .catch((err) => {
        return console.log('Error retreiving original Drupal composer: ', err)
      })
  },
  getRemoteTemplates: function() {
    const templates = this.config.codeTemplates
    const urls = Object.values(templates)
    const replacements = { ver: `${this.drupalVer}.x` }
    const results = {}
    // Replace tokens in URLs with replacements object
    urls.map((url, i) => {
      urls[i] = this.templateReplace(url, replacements)
    })
    // Build promises for request module with provided URLs
    const promises = urls.map(url => request(url));
    // Return a promise once all urls have been retrieved
    return new Promise((resolve, reject) => {
      Promise.all(promises)
        .then((data) => {
          Object.keys(templates).map((template, i) => {
            const ext = urls[i].split('.').pop()
            if(ext == 'json') {
              return results[template] = JSON.parse(data[i])
            }
            return results[template] = data[i]
          })
          resolve(results)
        })
        .catch((err) => {
          reject(err)
        })
    })   
  },
  getComposerLocal: function(appPath) {
    appPath = this.appPath || appPath
    const composerPath = path.join(appPath,'composer.json')
    if (!fs.existsSync(composerPath)) {
      return console.log(`${composerPath} doesn't exist, please check your Drupal installation`)
    }
    const contents = fs.readFileSync(composerPath, 'utf8')
    return this.composerLocal = JSON.parse(contents)
  },
  getDrushModules: function(moduleDir) {
    const composerJson = {}
    this.getModuleDirs(moduleDir).map(module => {
      const configFile = `/${module}.info.yml`
      const configPath = path.join(moduleDir, module, configFile)
      try {
        if (!fs.existsSync(configPath)) return
        const contents = fs.readFileSync(configPath, 'utf8')
        // Parse YML into object
        const config = yaml.safeLoad(contents)
        const verArray = config.version.split('-')
        let verString = `^${verArray[1]}`
        // If the version contains a version state (alpha, beta, dev) append it
        if(2 in verArray) {
          // Dev requires dashes!
          const symbol = (verArray[2] == 'dev') ? '-' : '@'
          verString += symbol + verArray[2].replace(/[0-9]/g, '')
        }
        composerJson[`drupal/${module}`] = verString
      } catch (e) {
        const msg = `Error parsing ${configPath}. Check the config file to `
                  + `ensure it's properly properly formatted in YML and has a `  
                  + `version number or install it manually when you're done:\n`
                  + `composer require drupal/${module}\n\n`
        console.warn(msg)
      }
    })
    return composerJson
  },
  getModuleDirs: function(moduleDir) {
    return fs.readdirSync(moduleDir)
              .filter(dir => fs.statSync(path.join(moduleDir, dir)).isDirectory())
              .filter(dir => !(/(^|\/)\.[^\/\.]/g).test(dir))
  },
  shallowDiff: function(a, b) {
    const diffArr = _.difference(_.keys(a), _.keys(b))
    const diffObj = {}
    diffArr.map((item) => {
      diffObj[item] = a[item]
    })
    return diffObj
  },
  templateReplace: function(string, replacements) {
    return string.replace(
        /{(\w*)}/g, // or /{(\w*)}/g for "{this} instead of %this%"
        ( m, key ) => {
          return replacements.hasOwnProperty( key ) ? replacements[ key ] : ''
        })
  } 
}

app.init()


