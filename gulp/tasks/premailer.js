var gulp = require('gulp');
var premailer = require('gulp-premailer');

gulp.task('inline-css', function () {
    gulp.src('newsletter.html')
        .pipe(premailer())
        .pipe(gulp.dest('newsletter/'));
});
