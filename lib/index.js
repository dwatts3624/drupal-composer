const config = require('./config'),
      fs = require('fs'),
      path = require('path'),
      yaml = require('js-yaml'),
      inquirer = require('inquirer'),
      request = require('request-promise'),
      colors = require('colors'),
      _ = require('lodash')
      
const app = {
  config: config,
  currPath: path.resolve('.'),
  appPath: '',
  composerLocal: {},
  drupalVer: '',
  newComposer: {},
  remoteTemplates: {},
  prompt: function() {
    if (fs.existsSync(path.join(this.currPath, 'composer.json'))) {
      //return console.error('A composer.json file exists in your project root. Remove it before starting.')
    }
    return inquirer.prompt([{
      type: 'input',
      name: 'drupalLocation',
      message: 'Where is your Drupal app located?',
      default: this.config.drupalRoot
    }])
      .then(this.init.bind(this))
  },
  init: function(answers) {
    const appPath = path.join(this.currPath, answers.drupalLocation)
    if (!fs.existsSync(appPath)) {
      return console.log(`${appPath} is not valid please try again with a valid directory`)
    }
    this.appPath = appPath
    const composerLocal = this.getComposerLocal()
    const drupalVer = composerLocal.replace['drupal/core'].replace(/[^0-9.]/g, '')
    this.drupalVer = drupalVer
    console.log('Retreiving remote templates from repositories\n')
    // Once all remote templates are downloaded begin primary operations
    return this.getRemoteTemplates()
      .then(this.buildNewComposer.bind(this))
      .catch((err) => {
        return console.error('Error: ', err)
      })
  },
  buildNewComposer: function(remoteTemplates) {
    console.log('Building new composer file from default composer and installed modules\n')
    this.remoteTemplates = remoteTemplates
    // Create the new composer file from the remote default
    this.newComposer = remoteTemplates.drupalComposer
    // Compare local composer against original to determine which were installed
    const composerModules = this.shallowDiff(
                                this.composerLocal.require, 
                                remoteTemplates.drupalDefaultComposer.require)
    const drushModules = {}
    const modulePaths = Object.keys(this.config.modulePaths)
    // Construct composer syntax for all currently isntalled modules
    modulePaths.map((key, i) => {
      const baseModulePath = this.config.modulePaths[key]
      const modulePath = path.join(this.appPath, baseModulePath)
      drushModules[modulePaths[i]] = this.getDrushModules(modulePath)
    })
    // Combine all known modules for composer
    const combinedModules = _.defaults(
                              composerModules, 
                              drushModules.base,
                              drushModules.contrib,
                              remoteTemplates.drupalComposer['require'])
    // Replace the defaults with new combined & sorted modules
    this.newComposer['require'] = this.sortKeysBy(combinedModules)
    // Combine all known modules for composer
    const combinedDevModules = _.defaults(
                              drushModules.dev,
                              remoteTemplates.drupalComposer['require-dev'])
    // Replace the defaults with new combined & sorted modules
    this.newComposer['require-dev'] = this.sortKeysBy(combinedDevModules)
    // Once complete begin the installation process
    return this.installComposerSystem()
  },
  installComposerSystem: function() {
    console.log('Creating directories: "drush" and "scripts/composer" unless they already exist\n')
    const dirs = {
      'drush': path.join(this.currPath,'drush'),
      'scripts': path.join(this.currPath,'scripts'),
      'scripts/composer': path.join(this.currPath, 'scripts/composer')
    }
    Object.values(dirs).map((dir) => {
      try {
        fs.mkdirSync(dir);
      } catch(err) {}
    })
    console.log('Writing dependency files to filesystem\n')
    // Setup the files we want to process from config
    const processFiles = { 
      'drupalComposerDrush' : 'drush',
      'drupalComposerScriptHandler' : 'scripts/composer'
    }
    // Loop through them and write out the corresponding files
    Object.keys(processFiles).map((key, i) => {
      const url = this.config.codeTemplates[key]
      const file = url.split('/').pop()
      const dir = dirs[processFiles[key]]
      fs.writeFileSync(path.join(dir, file), this.remoteTemplates[key])
    })
    console.log('Writing main composer file\n')
    const newComposer = JSON.stringify(this.newComposer, null, 4)
    fs.writeFileSync(path.join(this.currPath, 'composer.json'), newComposer)
    // Finished operations!
    return this.operationComplete()
  },
  operationComplete: function() {
    let msg = `All operations are complete! If there are modules that need to `
            + `be installed from errors install them now.  Then run: \n`
    console.log(msg)
    console.log('composer install\n'.green)
        msg = `When you are ready to remove composer-controlled modules from `
            + `your repository add the following lines: \n`
    console.log(msg)
    console.log(this.remoteTemplates.drupalComposerIgnore.green)
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
      return console.error(`${composerPath} doesn't exist, please check your Drupal installation`)
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
        console.warn(msg)
        console.log(`composer require drupal/${module}\n`.red)
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
  sortKeysBy: function (obj, comparator) {
    var keys = _.sortBy(_.keys(obj), (key) => {
      return comparator ? comparator(obj[key], key) : key
    })
    return _.zipObject(keys, _.map(keys, (key) => {
      return obj[key]
    }))
  },
  templateReplace: function(string, replacements) {
    return string.replace(
        /{(\w*)}/g, // or /{(\w*)}/g for "{this} instead of %this%"
        ( m, key ) => {
          return replacements.hasOwnProperty( key ) ? replacements[ key ] : ''
        })
  } 
}
 
module.exports = app;
