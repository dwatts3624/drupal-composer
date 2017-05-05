const config = require('../lib/config'),
      fs = require('fs'),
      path = require('path'),
      yaml = require('js-yaml'),
      inquirer = require('inquirer'),
      request = require('request')
      



const app = {
  //currPath = '/Users/danny/Projects/drupal-composer-builder/site'
  config: config,
  currPath: path.resolve('.'),
  appPath: '',
  originalComposer: {},
  drupalVer: '',
  init: function() {
    inquirer.prompt([{
      type: 'input',
      name: 'appLocation',
      message: 'Where is your app located?',
      default: this.config.defaultDir
    }])
      .then(this.operate.bind(this))
  },
  operate: function(answers) {
    const appPath = path.join(this.currPath, answers.appLocation)
    if (!fs.existsSync(appPath)) {
      return console.log(`${appPath} is not valid please try again with a valid directory`)
    }
    this.appPath = appPath
    this.getOrigComposerLocal()
    
    const drupalVer = this.originalComposer.replace['drupal/core'].replace(/[^0-9.]/g, '')
    this.drupalVer = drupalVer
    console.log(drupalVer)
    this.getOrigComposerRemote()
      .then((data) => {
        console.log(data)
      })
      .catch((err) => {
        return console.log('Error retreiving original Drupal composer: ', err)
      })
  },
  getOrigComposerRemote: function() {
    const url = this.templateReplace(
                  this.config.drupalComposerUrl, 
                  { ver: `${this.drupalVer}.x` })
    // Return the composer contents from the constructed URL with a promise
    return new Promise((resolve, reject) => {
      request(url, (err, response, body) => {
        if(err) reject(err)
        resolve(JSON.parse(body))
      })
    })
  },
  getOrigComposerLocal: function(appPath) {
    appPath = this.appPath || appPath
    const originalComposerPath = path.join(appPath,'composer.json')
    if (!fs.existsSync(originalComposerPath)) {
      return console.log(`${originalComposerPath} doesn't exist, please check your Drupal installation`)
    }
    const contents = fs.readFileSync(originalComposerPath, 'utf8')
    return this.originalComposer = JSON.parse(contents)
  },
  buildComposerModules: function() {
    const composerJson = {}
    dirs(this.currPath).map(module => {
      try {
        const configFile = `/${module}.info.yml`
        const configPath = path.join(this.currPath, module, configFile)
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
        console.log(e)
      }
    })
    return composerJson
  },
  getModuleDirs: function(path) {
    return fs.readdirSync(path)
              .filter(f => fs.statSync(path.join(path, file)).isDirectory())
              .filter(f => !(/(^|\/)\.[^\/\.]/g).test(file))
  },
  templateReplace: function(string, replacements) {
    return string.replace(
        /{(\w*)}/g, // or /{(\w*)}/g for "{this} instead of %this%"
        ( m, key ) => {
          return replacements.hasOwnProperty( key ) ? replacements[ key ] : '';
        })
  } 
}

app.init()


