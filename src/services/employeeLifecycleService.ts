import mongoose, { Types } from 'mongoose';
import { deriveHiringScope, validateManagerDocuments } from '../utils/hiringScope';
import { normalizeRoleKey } from '../utils/emsApprovalRules';
import { User } from '../models/user.model';
import { Employee } from '../models/employee.model';
import { RecruitmentApplication } from '../models/recruitmentApplication.model';
import { generateSecureHash } from '../utils/passwordHelper';
import { generateUniqueId } from '../utils/generator';
import { Logger } from '../utils/logger';
import { PANEL_ACCOUNT_ROLES } from '../utils/accountScope';
import { generateApplicantPassword } from '../utils/applicantPassword';

export async function automateEmployeeCreationOnApproval(applicationId: string, options: { password?: string } = {}) {
    try {
        const app = await RecruitmentApplication.findOne({
            $or: [...(Types.ObjectId.isValid(applicationId) ? [{ _id: applicationId }] : []), { applicationId }]
        });

        if (!app || app.status !== 'approved') {
            return { success: false, message: 'Application is not approved or not found' };
        }

        const sponsor = app.referrer?.referrerId ? await User.findById(app.referrer.referrerId).lean() : null;
        validateManagerDocuments(app.role, app.documents);
        const hiringScope = deriveHiringScope(sponsor, app.role, { ...app.roleData, country: app.applicant.country });
        // Check if user account already exists by Yaro ID / userId or email
        const rawYaroId = app.applicant?.yaroId || app.applicant?.userId || (app.roleData as any)?.yaroId || (app.roleData as any)?.userId;
        let user: any = null;
        if (rawYaroId && !isNaN(Number(rawYaroId))) {
            user = await User.findOne({ userId: Number(rawYaroId), role: { $in: PANEL_ACCOUNT_ROLES } });
        }
        if (!user) {
            user = await User.findOne({
                email: app.applicant.email.toLowerCase(),
                role: { $in: PANEL_ACCOUNT_ROLES },
            });
        }

        const candidatePassword = (typeof options.password === 'string' && options.password.trim() !== '')
            ? options.password.trim()
            : generateApplicantPassword(app.applicant.name, app.applicant.phone, app.applicant.email);
        const generatedPassword = candidatePassword;
        const defaultPassword = await generateSecureHash(generatedPassword);

        if (!user) {
            const newUserId = await generateUniqueId();
            const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
            const employeeCode = `EMP${newUserId}${randomCode}`;

            user = await User.create({
                userId: newUserId,
                name: app.applicant.name,
                email: app.applicant.email.toLowerCase(),
                phoneNumber: app.applicant.phone,
                password: defaultPassword,
                role: normalizeRoleKey(app.role),
                hiringScope,
                documents: app.documents.map(d => d.url),
                country: { name: app.applicant.country || '' },
                state: app.roleData.state || '',
                parentId: sponsor?._id,
                hierarchyPath: sponsor ? `${sponsor.hierarchyPath || ''}/${sponsor._id}` : '',
                gender: app.applicant.gender || 'other',
                employeeCode,
                isActive: true,
                emailVerified: true
            });
        } else {
            // Ensure password is synchronized with the approved credentials
            user.password = defaultPassword;
            user.isActive = true;
            user.isBlocked = false;
            user.isDeleted = false;
            user.emailVerified = true;
        }

        if (['owner', 'operator'].includes(user.role) && user.role !== normalizeRoleKey(app.role)) {
            throw new Error('A protected account cannot be reassigned through recruitment');
        }
        if (['country-manager', 'state-manager', 'super-admin', 'admin', 'operator', 'customer-service'].includes(app.role)) user.role = normalizeRoleKey(app.role);
        user.documents = app.documents.map(d => d.url);
        user.hiringScope = hiringScope;
        if (sponsor) { user.parentId = sponsor._id; user.hierarchyPath = `${sponsor.hierarchyPath || ''}/${sponsor._id}`; }
        await user.save();

        // Sync password with linked RequestModel so Request center table has exact matching credentials
        if (mongoose.connection.readyState === 1) {
            try {
                const { Request: RequestModel } = await import('../models/request.model');
                await RequestModel.updateMany(
                    {
                        $or: [
                            { 'data.recruitmentAppId': String(app._id) },
                            { 'data.email': app.applicant.email.toLowerCase() },
                            { 'data.mithiChatId': app.applicationId }
                        ]
                    },
                    {
                        $set: {
                            passwordBeforeApproval: generatedPassword,
                            'data.password': generatedPassword
                        }
                    }
                );
            } catch (syncErr) {
                console.error('[automateEmployeeCreationOnApproval] Failed to sync RequestModel password:', syncErr);
            }
        }

        // Store password on application roleData
        app.roleData = {
            ...(app.roleData || {}),
            password: generatedPassword
        };
        if (typeof (app as any).save === 'function') {
            await (app as any).save();
        }

        // Check if employee record already exists
        let employee = await Employee.findOne({ userId: user._id });
        if (!employee) {
            employee = await Employee.create({
                employeeCode: user.employeeCode || `EMP-${user.userId}`,
                userId: user._id,
                applicationId: app.applicationId,
                designation: `${app.role.toUpperCase()} Lead`,
                status: 'active_employee',
                joiningDate: new Date(),
                offerLetterUrl: `https://api.yaroapp.in/policies/offer-${app.applicationId}.pdf`
            });
        }

        return { success: true, user, employee, generatedCredentials: {
            email: user.email, password: generatedPassword, role: user.role, employeeCode: user.employeeCode,
            userId: user.userId, loginUrl: 'https://admin.yaroapp.in/login',
        } };
    } catch (error: any) {
        await Logger('automateEmployeeCreationOnApproval', error);
        return { success: false, message: error.message || 'Failed to automate employee lifecycle' };
    }
}
