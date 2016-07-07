var gulp = require('gulp'),
$ = require('gulp-load-plugins')(),
del = require('del'),
runSequence = require('run-sequence'),
config = require('../config');

gulp.task('start1', function(callback){
  del([
    './app/fonts/dense.*',
    './app/fontgen/dense.*',
    './app/pages',
    './app/templates/layout.html',
    './app/data/categories.json',
    './app/templates/partials/*.*',
    '!./app/templates/partials/datepicker.html',
    './app/sass/project',
    './app/sass/style.sass'
    ], callback);
});
gulp.task('start2', function(){
  return gulp.src('app/start/index.html')
  .pipe(gulp.dest('./app/pages/'))
});
gulp.task('start3', function(){
  return gulp.src('app/start/layout.html')
  .pipe(gulp.dest('./app/templates'))
});
gulp.task('start4', function(){
  return gulp.src('app/start/layout.sass')
  .pipe(gulp.dest('./app/sass'))
});
gulp.task('start5', function(){
  return gulp.src('app/start/style.sass')
  .pipe(gulp.dest('./app/sass'))
});
gulp.task('start6', function(callback){
  del(['./app/start'], callback);
});
gulp.task('start7', function(callback){
  del(['./gulp/tasks/start.js'], callback);
});


gulp.task('start', function(callback) {
  runSequence(
    ['start1'],
    ['start2', 'start3', 'start4', 'start5'],
    ['start6', 'start7'],
    callback
    );
});
