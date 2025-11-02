const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  async initializeTransporter() {
    try {
      // Configure email transporter (you can use Gmail, SendGrid, etc.)
      this.transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        }
      });

      // Verify connection
      await this.transporter.verify();
      console.log('Email service initialized successfully');
    } catch (error) {
      console.error('Email service initialization failed:', error);
      // Continue without email service
    }
  }

  async sendSessionConfirmation(sessionData) {
    try {
      console.log('📧 Email Service - Starting session confirmation email...');
      console.log('📧 Email Service - Session data:', JSON.stringify(sessionData, null, 2));
      
      const {
        clientName,
        psychologistName,
        clientEmail,
        psychologistEmail,
        scheduledDate,
        scheduledTime,
        googleMeetLink,
        sessionId,
        sessionDate,
        sessionTime,
        meetLink,
        price
      } = sessionData;

      // Use consistent date/time format
      const finalSessionDate = sessionDate || scheduledDate;
      const finalSessionTime = sessionTime || scheduledTime;
      const finalMeetLink = meetLink || googleMeetLink;
      
      console.log('📧 Email Service - Final values:', {
        clientName,
        psychologistName,
        clientEmail,
        psychologistEmail,
        finalSessionDate,
        finalSessionTime,
        finalMeetLink,
        sessionId,
        price
      });
      
      // Check if transporter is available
      if (!this.transporter) {
        console.error('📧 Email Service - Transporter not initialized');
        throw new Error('Email service not properly initialized');
      }
      
      // Parse date and time in IST (UTC+5:30)
      const sessionDateTime = new Date(`${finalSessionDate}T${finalSessionTime}+05:30`);
      const formattedDate = sessionDateTime.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      const formattedTime = sessionDateTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
        timeZoneName: 'short'
      });

      console.log('📅 Email formatting (IST):');
      console.log('   - Original time:', `${finalSessionDate}T${finalSessionTime}`);
      console.log('   - Session DateTime:', sessionDateTime.toISOString());
      console.log('   - Session DateTime (local):', sessionDateTime.toString());
      console.log('   - Session DateTime (IST):', sessionDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
      console.log('   - Formatted Date:', formattedDate);
      console.log('   - Formatted Time:', formattedTime);

      // Generate calendar invites
      const { createCalendarInvites, generateGoogleCalendarLink, generateOutlookCalendarLink } = require('./calendarInviteGenerator');
      
      const calendarData = {
        sessionId: sessionId || 'unknown',
        clientName,
        psychologistName,
        sessionDate: finalSessionDate,
        sessionTime: finalSessionTime,
        meetLink: finalMeetLink,
        clientEmail,
        psychologistEmail,
        price: price || 0
      };

      const calendarInvites = createCalendarInvites(calendarData);
      const googleCalendarLink = generateGoogleCalendarLink(calendarData);
      const outlookCalendarLink = generateOutlookCalendarLink(calendarData);

      // Send email to client
      if (clientEmail && !clientEmail.includes('placeholder')) {
        console.log('📧 Sending email to client:', clientEmail);
        await this.sendClientConfirmation({
          to: clientEmail,
          clientName,
          psychologistName,
          scheduledDate: formattedDate,
          scheduledTime: formattedTime,
          googleMeetLink: finalMeetLink,
          sessionId,
          calendarInvite: calendarInvites.client,
          googleCalendarLink,
          outlookCalendarLink,
          price
        });
      } else {
        console.log('⚠️ Skipping client email (placeholder or missing):', clientEmail);
      }

      // Send email to psychologist
      if (psychologistEmail && !psychologistEmail.includes('placeholder')) {
        console.log('📧 Sending email to psychologist:', psychologistEmail);
        await this.sendPsychologistConfirmation({
          to: psychologistEmail,
          clientName,
          psychologistName,
          scheduledDate: formattedDate,
          scheduledTime: formattedTime,
          googleMeetLink: finalMeetLink,
          sessionId,
          calendarInvite: calendarInvites.psychologist,
          googleCalendarLink,
          outlookCalendarLink,
          price
        });
      } else {
        console.log('⚠️ Skipping psychologist email (placeholder or missing):', psychologistEmail);
      }

      // Send email to company admin
      const adminEmail = process.env.COMPANY_ADMIN_EMAIL;
      if (adminEmail) {
        await this.sendAdminNotification({
          to: adminEmail,
          clientName,
          psychologistName,
          scheduledDate: formattedDate,
          scheduledTime: formattedTime,
          sessionId
        });
      }

      return true;
    } catch (error) {
      console.error('Error sending session confirmation emails:', error);
      return false;
    }
  }

  async sendClientConfirmation(emailData) {
    const { 
      to, 
      clientName, 
      psychologistName, 
      scheduledDate, 
      scheduledTime, 
      googleMeetLink, 
      sessionId,
      calendarInvite,
      googleCalendarLink,
      outlookCalendarLink,
      price
    } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `Session Confirmed - ${scheduledDate} at ${scheduledTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Session Confirmed!</h1>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Hello ${clientName},</h2>
            
            <p>Your therapy session has been successfully scheduled. Here are the details:</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
              <h3 style="color: #667eea; margin-top: 0;">Session Details</h3>
              <p><strong>Date:</strong> ${scheduledDate}</p>
              <p><strong>Time:</strong> ${scheduledTime}</p>
              <p><strong>Therapist:</strong> ${psychologistName}</p>
              <p><strong>Session Fee:</strong> $${price || 'TBD'}</p>
              <p><strong>Session ID:</strong> ${sessionId}</p>
            </div>
            
            ${googleCalendarLink || outlookCalendarLink ? `
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">📅 Add to Your Calendar</h3>
              <p>Don't forget your appointment! Add it to your calendar:</p>
              <div style="margin: 15px 0;">
                ${googleCalendarLink ? `
                <a href="${googleCalendarLink}" target="_blank" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">
                  📅 Add to Google Calendar
                </a>
                ` : ''}
                ${outlookCalendarLink ? `
                <a href="${outlookCalendarLink}" target="_blank" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">
                  📅 Add to Outlook
                </a>
                ` : ''}
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 15px;">
                💡 <strong>Tip:</strong> Adding this to your calendar will help you remember your appointment and receive automatic reminders.
              </p>
            </div>
            ` : ''}
            
            ${googleMeetLink ? `
            <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #28a745; margin-top: 0;">Join Your Session</h3>
              <p>Click the button below to join your Google Meet session:</p>
              <a href="${googleMeetLink}" style="display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Join Google Meet
              </a>
              <p style="margin-top: 10px; font-size: 14px; color: #666;">
                Or copy this link: <a href="${googleMeetLink}">${googleMeetLink}</a>
              </p>
            </div>
            ` : ''}
            
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">Important Reminders</h3>
              <ul style="color: #856404;">
                <li>Please join the session 5 minutes before the scheduled time</li>
                <li>Ensure you have a stable internet connection</li>
                <li>Find a quiet, private space for your session</li>
                <li>Have any relevant documents or notes ready</li>
              </ul>
            </div>
            
            <p>If you need to reschedule or have any questions, please contact us at support@kuttikal.com</p>
            
            <p>We look forward to supporting you on your wellness journey!</p>
            
            <p>Best regards,<br>The Kuttikal Team</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This email was sent to confirm your therapy session. 
              If you have any questions, please contact support@kuttikal.com
            </p>
          </div>
        </div>
      `,
      attachments: calendarInvite ? [
        {
          filename: calendarInvite.filename,
          content: calendarInvite.content,
          contentType: calendarInvite.contentType
        }
      ] : []
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendPsychologistConfirmation(emailData) {
    const { 
      to, 
      clientName, 
      psychologistName, 
      scheduledDate, 
      scheduledTime, 
      googleMeetLink, 
      sessionId,
      calendarInvite,
      googleCalendarLink,
      outlookCalendarLink,
      price
    } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `New Session Scheduled - ${scheduledDate} at ${scheduledTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">New Session Scheduled</h1>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Hello ${psychologistName},</h2>
            
            <p>A new therapy session has been scheduled with you. Here are the details:</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #28a745; margin-top: 0;">Session Details</h3>
              <p><strong>Date:</strong> ${scheduledDate}</p>
              <p><strong>Time:</strong> ${scheduledTime}</p>
              <p><strong>Client:</strong> ${clientName}</p>
              <p><strong>Session Fee:</strong> $${price || 'TBD'}</p>
              <p><strong>Session ID:</strong> ${sessionId}</p>
            </div>
            
            ${googleCalendarLink || outlookCalendarLink ? `
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">📅 Add to Your Calendar</h3>
              <p>Add this session to your calendar:</p>
              <div style="margin: 15px 0;">
                ${googleCalendarLink ? `
                <a href="${googleCalendarLink}" target="_blank" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">
                  📅 Add to Google Calendar
                </a>
                ` : ''}
                ${outlookCalendarLink ? `
                <a href="${outlookCalendarLink}" target="_blank" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold;">
                  📅 Add to Outlook
                </a>
                ` : ''}
              </div>
            </div>
            ` : ''}
            
            ${googleMeetLink ? `
            <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #28a745; margin-top: 0;">Session Link</h3>
              <p>Your Google Meet session is ready:</p>
              <a href="${googleMeetLink}" style="display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Start Session
              </a>
              <p style="margin-top: 10px; font-size: 14px; color: #666;">
                Or copy this link: <a href="${googleMeetLink}">${googleMeetLink}</a>
              </p>
            </div>
            ` : ''}
            
            <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h3 style="color: #0c5460; margin-top: 0;">Session Preparation</h3>
              <ul style="color: #0c5460;">
                <li>Review client information and previous session notes</li>
                <li>Prepare any relevant materials or resources</li>
                <li>Ensure your workspace is professional and private</li>
                <li>Test your audio and video equipment</li>
              </ul>
            </div>
            
            <p>Please ensure you're available 5 minutes before the scheduled time to start the session.</p>
            
            <p>If you need to reschedule or have any questions, please contact the admin team.</p>
            
            <p>Best regards,<br>The Kuttikal Team</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This email confirms your scheduled therapy session. 
              Please ensure you're prepared and than on time.
            </p>
          </div>
        </div>
      `,
      attachments: calendarInvite ? [
        {
          filename: calendarInvite.filename,
          content: calendarInvite.content,
          contentType: calendarInvite.contentType
        }
      ] : []
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendAdminNotification(emailData) {
    const { to, clientName, psychologistName, scheduledDate, scheduledTime, sessionId } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `New Session Booked - ${scheduledDate} at ${scheduledTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">New Session Booked</h1>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Admin Notification</h2>
            
            <p>A new therapy session has been booked on the platform. Here are the details:</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6f42c1;">
              <h3 style="color: #6f42c1; margin-top: 0;">Session Details</h3>
              <p><strong>Date:</strong> ${scheduledDate}</p>
              <p><strong>Time:</strong> ${scheduledTime}</p>
              <p><strong>Client:</strong> ${clientName}</p>
              <p><strong>Therapist:</strong> ${psychologistName}</p>
              <p><strong>Session ID:</strong> ${sessionId}</p>
            </div>
            
            <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <h3 style="color: #721c24; margin-top: 0;">Action Required</h3>
              <ul style="color: #721c24;">
                <li>Verify session details in the admin panel</li>
                <li>Ensure therapist availability is confirmed</li>
                <li>Check if any special accommodations are needed</li>
                <li>Monitor session completion and follow-up</li>
              </ul>
            </div>
            
            <p>This session has been automatically added to the Google Calendar and all parties have been notified.</p>
            
            <p>Best regards,<br>Kuttikal Platform</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This is an automated notification from the Kuttikal therapy platform.
            </p>
          </div>
        </div>
      `
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendRescheduleNotification(sessionData, oldDate, oldTime) {
    try {
      const {
        clientName,
        psychologistName,
        clientEmail,
        psychologistEmail,
        scheduledDate,
        scheduledTime,
        sessionId,
        meetLink
      } = sessionData;

      const oldDateTime = new Date(`${oldDate}T${oldTime}`);
      const newDateTime = new Date(`${scheduledDate}T${scheduledTime}`);

      const formattedOldDate = oldDateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const formattedOldTime = oldDateTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      const formattedNewDate = newDateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const formattedNewTime = newDateTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      // Send reschedule notifications
      if (clientEmail) {
        await this.sendRescheduleEmail({
          to: clientEmail,
          name: clientName,
          oldDate: formattedOldDate,
          oldTime: formattedOldTime,
          newDate: formattedNewDate,
          newTime: formattedNewTime,
          sessionId,
          meetLink,
          type: 'client'
        });
      }

      if (psychologistEmail) {
        await this.sendRescheduleEmail({
          to: psychologistEmail,
          name: psychologistName,
          oldDate: formattedOldDate,
          oldTime: formattedOldTime,
          newDate: formattedNewDate,
          newTime: formattedNewTime,
          sessionId,
          meetLink,
          type: 'psychologist'
        });
      }

      return true;
    } catch (error) {
      console.error('Error sending reschedule notifications:', error);
      return false;
    }
  }

  async sendRescheduleEmail(emailData) {
    const { to, name, oldDate, oldTime, newDate, newTime, sessionId, meetLink, type } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `Session Rescheduled - ${newDate} at ${newTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #fd7e14 0%, #ffc107 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Session Rescheduled</h1>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Hello ${name},</h2>
            
            <p>Your therapy session has been rescheduled. Here are the updated details:</p>
            
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">Previous Schedule</h3>
              <p><strong>Date:</strong> ${oldDate}</p>
              <p><strong>Time:</strong> ${oldTime}</p>
            </div>
            
            <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #155724; margin-top: 0;">New Schedule</h3>
              <p><strong>Date:</strong> ${newDate}</p>
              <p><strong>Time:</strong> ${newTime}</p>
            </div>
            
            <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h3 style="color: #0c5460; margin-top: 0;">Session Information</h3>
              <p><strong>Session ID:</strong> ${sessionId}</p>
              <p><strong>Type:</strong> ${type === 'client' ? 'Client' : 'Therapist'}</p>
              ${meetLink ? `<p><strong>New Google Meet Link:</strong> <a href="${meetLink}" style="color: #17a2b8;">${meetLink}</a></p>` : ''}
            </div>
            
            ${meetLink ? `
            <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #155724; margin-top: 0;">🔗 Meeting Link</h3>
              <p style="color: #155724;">Your new Google Meet link for the rescheduled session:</p>
              <p style="word-break: break-all;"><a href="${meetLink}" style="color: #28a745; font-weight: bold;">${meetLink}</a></p>
            </div>
            ` : ''}
            
            <p>Please update your calendar and ensure you're available at the new time.</p>
            
            <p>If you have any questions or need to make further changes, please contact us.</p>
            
            <p>Best regards,<br>The Kuttikal Team</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This email confirms your session has been rescheduled. 
              Please note the new date and time.
            </p>
          </div>
        </div>
      `
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendFreeAssessmentConfirmation(assessmentData) {
    try {
      const {
        clientName,
        psychologistName,
        assessmentDate,
        assessmentTime,
        assessmentNumber,
        clientEmail,
        psychologistEmail,
        googleMeetLink
      } = assessmentData;

      // Parse date and time in IST (UTC+5:30)
      const assessmentDateTime = new Date(`${assessmentDate}T${assessmentTime}+05:30`);
      const formattedDate = assessmentDateTime.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      const formattedTime = assessmentDateTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
        timeZoneName: 'short'
      });

      // Send email to client
      if (clientEmail && !clientEmail.includes('placeholder')) {
        console.log('📧 Sending free assessment confirmation to client:', clientEmail);
        await this.sendClientFreeAssessmentConfirmation({
          to: clientEmail,
          clientName,
          psychologistName,
          assessmentDate: formattedDate,
          assessmentTime: formattedTime,
          assessmentNumber,
          googleMeetLink
        });
      }

      // Send email to psychologist
      if (psychologistEmail && !psychologistEmail.includes('placeholder')) {
        console.log('📧 Sending free assessment notification to psychologist:', psychologistEmail);
        await this.sendPsychologistFreeAssessmentNotification({
          to: psychologistEmail,
          clientName,
          psychologistName,
          assessmentDate: formattedDate,
          assessmentTime: formattedTime,
          assessmentNumber,
          googleMeetLink
        });
      }

      return true;
    } catch (error) {
      console.error('Error sending free assessment confirmation:', error);
      return false;
    }
  }

  async sendClientFreeAssessmentConfirmation(emailData) {
    const { to, clientName, psychologistName, assessmentDate, assessmentTime, assessmentNumber, googleMeetLink } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `Free Assessment Confirmed - ${assessmentDate} at ${assessmentTime}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Free Assessment Confirmed</title>
        </head>
        <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white;">
            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Free Assessment Confirmed!</h1>
            </div>
            
            <div style="padding: 20px;">
              <h2 style="color: #333; margin-top: 0;">Hello ${clientName},</h2>
              
              <p>Your free assessment session has been successfully booked! Here are the details:</p>
              
              <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
                <h3 style="color: #155724; margin-top: 0;">Assessment Details</h3>
                <p><strong>Assessment Number:</strong> ${assessmentNumber} of 20</p>
                <p><strong>Date:</strong> ${assessmentDate}</p>
                <p><strong>Time:</strong> ${assessmentTime}</p>
                <p><strong>Duration:</strong> 20 minutes</p>
                <p><strong>Therapist:</strong> ${psychologistName}</p>
                <p><strong>Type:</strong> Free Assessment Session</p>
              </div>
              
              <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
                <h3 style="color: #0c5460; margin-top: 0;">Join Your Session</h3>
                <p>Your session will be conducted online via Google Meet.</p>
                ${googleMeetLink ? `
                  <p><strong>Meeting Link:</strong></p>
                  <p style="word-break: break-all; margin: 10px 0;">
                    <a href="${googleMeetLink}" style="color: #007bff; text-decoration: underline; font-size: 16px;">${googleMeetLink}</a>
                  </p>
                  <div style="text-align: center; margin: 20px 0;">
                    <a href="${googleMeetLink}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">
                      🎥 Join Meeting Now
                    </a>
                  </div>
                  <p style="font-size: 14px; color: #666; margin-top: 15px;">
                    <strong>Note:</strong> If the button doesn't work, copy and paste this link into your browser:<br>
                    <span style="background: #f8f9fa; padding: 5px; border-radius: 3px; font-family: monospace; font-size: 12px;">${googleMeetLink}</span>
                  </p>
                ` : '<p>Meeting link will be provided closer to the session time.</p>'}
              </div>
              
              <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <h3 style="color: #856404; margin-top: 0;">Important Notes</h3>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Please join the meeting 5 minutes before your scheduled time</li>
                  <li>Ensure you have a stable internet connection</li>
                  <li>Find a quiet, private space for your session</li>
                  <li>This is a free assessment session - no payment required</li>
                  <li>You have ${20 - assessmentNumber} free assessments remaining</li>
                </ul>
              </div>
              
              <p>If you need to cancel or reschedule, please contact us at least 24 hours in advance.</p>
              
              <p>We look forward to meeting you!</p>
              
              <p>Best regards,<br>The Kuttikal Team</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="color: #6c757d; font-size: 14px; margin: 0;">
                This is your free assessment session. No payment is required.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Free Assessment Confirmed!

Hello ${clientName},

Your free assessment session has been successfully booked!

Assessment Details:
- Assessment Number: ${assessmentNumber} of 20
- Date: ${assessmentDate}
- Time: ${assessmentTime}
- Duration: 20 minutes
- Therapist: ${psychologistName}
- Type: Free Assessment Session

Join Your Session:
Your session will be conducted online via Google Meet.

Meeting Link: ${googleMeetLink || 'Will be provided closer to session time'}

Important Notes:
- Please join the meeting 5 minutes before your scheduled time
- Ensure you have a stable internet connection
- Find a quiet, private space for your session
- This is a free assessment session - no payment required
- You have ${20 - assessmentNumber} free assessments remaining

If you need to cancel or reschedule, please contact us at least 24 hours in advance.

We look forward to meeting you!

Best regards,
The Kuttikal Team
      `
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendPsychologistFreeAssessmentNotification(emailData) {
    const { to, clientName, psychologistName, assessmentDate, assessmentTime, assessmentNumber, googleMeetLink } = emailData;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
      to: to,
      subject: `Free Assessment Scheduled - ${assessmentDate} at ${assessmentTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #17a2b8 0%, #6f42c1 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Free Assessment Scheduled</h1>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Hello ${psychologistName},</h2>
            
            <p>A free assessment session has been scheduled with you. Here are the details:</p>
            
            <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <h3 style="color: #155724; margin-top: 0;">Session Details</h3>
              <p><strong>Client Name:</strong> ${clientName}</p>
              <p><strong>Assessment Number:</strong> ${assessmentNumber} of 3</p>
              <p><strong>Date:</strong> ${assessmentDate}</p>
              <p><strong>Time:</strong> ${assessmentTime}</p>
              <p><strong>Duration:</strong> 20 minutes</p>
              <p><strong>Type:</strong> Free Assessment Session</p>
            </div>
            
            <div style="background: #d1ecf1; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h3 style="color: #0c5460; margin-top: 0;">Join Session</h3>
              <p>This session will be conducted online via Google Meet.</p>
              ${googleMeetLink ? `
                <p><strong>Meeting Link:</strong> <a href="${googleMeetLink}" style="color: #007bff; text-decoration: none;">${googleMeetLink}</a></p>
                <p style="margin-top: 15px;">
                  <a href="${googleMeetLink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Join Meeting
                  </a>
                </p>
              ` : '<p>Meeting link will be provided closer to the session time.</p>'}
            </div>
            
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">Important Notes</h3>
              <ul style="margin: 0; padding-left: 20px;">
                <li>This is a free assessment session - no payment involved</li>
                <li>Please join the meeting 5 minutes before the scheduled time</li>
                <li>Focus on understanding the client's needs and concerns</li>
                <li>Provide recommendations for future therapy sessions if appropriate</li>
                <li>Session duration is 20 minutes</li>
              </ul>
            </div>
            
            <p>Please ensure you're available at the scheduled time.</p>
            
            <p>Best regards,<br>The Kuttikal Team</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              This is a free assessment session. Please provide quality care.
            </p>
          </div>
        </div>
      `
    };

    return this.transporter.sendMail(mailOptions);
  }

  // Send session completion notification to client
  // Generic email sending function
  async sendEmail({ to, subject, html, text }) {
    try {
      if (!this.transporter) {
        throw new Error('Email service not initialized');
      }

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
        to: to,
        subject: subject,
        html: html,
        text: text
      };

      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async sendCancellationNotification({
    to,
    clientName,
    psychologistName,
    sessionDate,
    sessionTime,
    sessionId,
    isPsychologist = false
  }) {
    try {
      const sessionDateTime = new Date(`${sessionDate}T${sessionTime}`);
      const formattedDate = sessionDateTime.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      const formattedTime = sessionDateTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
        timeZoneName: 'short'
      });

      const recipientName = isPsychologist ? psychologistName : clientName;
      const otherParty = isPsychologist ? clientName : `Dr. ${psychologistName}`;

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
        to: to,
        subject: 'Session Cancelled',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 28px;">Session Cancelled</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Session cancellation confirmation</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #2d3748; margin-top: 0;">Hello ${recipientName},</h2>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Your therapy session with <strong>${otherParty}</strong> has been cancelled.
              </p>
              
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
                <h3 style="color: #2d3748; margin-top: 0;">Cancelled Session Details</h3>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Date:</strong> ${formattedDate}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Time:</strong> ${formattedTime}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Session ID:</strong> ${sessionId}</p>
              </div>
              
              ${!isPsychologist ? `
              <div style="background: #e6fffa; border: 1px solid #81e6d9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0; color: #234e52; font-size: 14px;">
                  <strong>📅 Need to reschedule?</strong><br>
                  You can book a new session anytime from your profile dashboard.
                </p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'https://kuttikal.vercel.app'}/profile" 
                   style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  Book New Session
                </a>
              </div>
              ` : ''}
              
              <p style="color: #4a5568; line-height: 1.6;">
                If you have any questions, please contact our support team.
              </p>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Best regards,<br>
                <strong>The Kuttikal Team</strong>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px;">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>&copy; 2024 Kuttikal. All rights reserved.</p>
            </div>
          </div>
        `
      };

      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending cancellation notification:', error);
      throw error;
    }
  }

  async sendNoShowNotification({
    to,
    clientName,
    psychologistName,
    sessionDate,
    sessionTime,
    sessionId
  }) {
    try {
      const sessionDateTime = new Date(`${sessionDate}T${sessionTime}`);
      const formattedDate = sessionDateTime.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      const formattedTime = sessionDateTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
        timeZoneName: 'short'
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
        to: to,
        subject: 'No-Show Notice - Session Missed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 28px;">⚠️ No-Show Notice</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Session missed - let's reschedule</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #2d3748; margin-top: 0;">Hello ${clientName},</h2>
              
              <p style="color: #4a5568; line-height: 1.6;">
                We noticed that you didn't attend your scheduled therapy session with <strong>Dr. ${psychologistName}</strong>.
              </p>
              
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff9800;">
                <h3 style="color: #2d3748; margin-top: 0;">Missed Session Details</h3>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Date:</strong> ${formattedDate}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Time:</strong> ${formattedTime}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Psychologist:</strong> Dr. ${psychologistName}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Session ID:</strong> ${sessionId}</p>
              </div>
              
              <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 20px; border-radius: 6px; margin: 20px 0;">
                <h3 style="color: #856404; margin-top: 0;">📞 Need Help?</h3>
                <p style="margin: 5px 0; color: #856404;">
                  <strong>Let us know the reason or contact our team to reschedule:</strong>
                </p>
                <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
                  <li>📧 Email: ${process.env.COMPANY_ADMIN_EMAIL || 'support@kuttikal.com'}</li>
                  <li>📱 WhatsApp: ${process.env.SUPPORT_PHONE || process.env.COMPANY_PHONE || 'Contact us via our support number'}</li>
                  <li>💬 Book a new session from your profile</li>
                </ul>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'https://kuttikal.vercel.app'}/profile" 
                   style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  Reschedule Session
                </a>
              </div>
              
              <p style="color: #4a5568; line-height: 1.6;">
                We're here to help you reschedule or address any concerns. Don't hesitate to reach out!
              </p>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Best regards,<br>
                <strong>The Kuttikal Team</strong>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px;">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>&copy; 2024 Kuttikal. All rights reserved.</p>
            </div>
          </div>
        `
      };

      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending no-show notification:', error);
      throw error;
    }
  }

  async sendSessionCompletionNotification({
    clientName,
    childName,
    psychologistName,
    sessionDate,
    sessionTime,
    clientEmail
  }) {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@kuttikal.com',
        to: clientEmail,
        subject: 'Session Completed - Summary & Report Available',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0; font-size: 28px;">Session Completed</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your therapy session summary and report are ready</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #2d3748; margin-top: 0;">Hello ${clientName},</h2>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Great news! Your therapy session with <strong>${psychologistName}</strong> has been completed.
              </p>
              
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4F46E5;">
                <h3 style="color: #2d3748; margin-top: 0;">Session Details</h3>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Child:</strong> ${childName}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Date:</strong> ${sessionDate}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Time:</strong> ${sessionTime}</p>
                <p style="margin: 5px 0; color: #4a5568;"><strong>Psychologist:</strong> ${psychologistName}</p>
              </div>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Your psychologist has provided a detailed summary and report of the session. You can now view these in your profile.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'https://kuttikal.vercel.app'}/profile" 
                   style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  View Session Summary & Report
                </a>
              </div>
              
              <div style="background: #e6fffa; border: 1px solid #81e6d9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0; color: #234e52; font-size: 14px;">
                  <strong>📋 What you'll find:</strong><br>
                  • Session summary with key points<br>
                  • Detailed report with findings and recommendations<br>
                  • Next steps for continued care
                </p>
              </div>
              
              <p style="color: #4a5568; line-height: 1.6;">
                If you have any questions about the session or need to schedule a follow-up, please don't hesitate to reach out.
              </p>
              
              <p style="color: #4a5568; line-height: 1.6;">
                Best regards,<br>
                <strong>The Kuttikal Team</strong>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px;">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>&copy; 2024 Kuttikal. All rights reserved.</p>
            </div>
          </div>
        `
      };

      return this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending session completion notification:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
